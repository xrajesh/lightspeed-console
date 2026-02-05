# Lightspeed Console UI Integration

This document describes the integration of interactive MCP tool UIs into the OpenShift Lightspeed Console.

## Overview

The OpenShift Lightspeed Console now supports displaying interactive HTML UIs for MCP tools that provide them. When a tool (like `pods_list` or `pods_top`) is executed, if it has an associated UI, the HTML content is fetched from the MCP server and displayed in an iframe within the console.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  OpenShift Lightspeed Console                    │
│                         (React/TypeScript)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Prompt.tsx - Handles streaming response                  │  │
│  │  - Parses SSE events including "tool_ui"                  │  │
│  │  - Stores ui_content in Redux state                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ResponseToolModal.tsx - Displays tool results            │  │
│  │  - Shows iframe with ui_content (srcDoc)                  │  │
│  │  - Falls back to raw text output                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ SSE streaming with tool_ui event
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Lightspeed Service                          │
│                         (Python/FastAPI)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  docs_summarizer.py - Main query processing               │  │
│  │  - iterate_with_tools() executes tool calls               │  │
│  │  - Detects tools with has_ui=True                         │  │
│  │  - Fetches UI HTML via mcp_client.read_resource()         │  │
│  │  - Yields StreamedChunk(type="tool_ui") with ui_content   │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  streaming_ols.py - HTTP endpoint handler                 │  │
│  │  - Converts StreamedChunk to SSE format                   │  │
│  │  - Emits "event: tool_ui" with ui_content in data         │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  llama_index/tools/mcp/base.py - MCP tool adapter         │  │
│  │  - Extracts _meta.ui from MCP tool definitions            │  │
│  │  - Attaches _ui_metadata to FunctionTool                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  tools/tools.py - Tool execution                          │  │
│  │  - execute_tool_call() returns ui_metadata                │  │
│  │  - Adds ui_metadata to ToolMessage.additional_kwargs      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ MCP Protocol (JSON-RPC over HTTP/SSE)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  OpenShift MCP Server (Go)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  pkg/toolsets/core/pods.go                                │  │
│  │  - pods_list tool with Meta["ui"]["resourceUri"]          │  │
│  │  - pods_top tool with Meta["ui"]["resourceUri"]           │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  pkg/mcp/ui_resources.go                                  │  │
│  │  - Embeds UI HTML files via //go:embed                    │  │
│  │  - Registers MCP resources for ui://pods_list/app.html    │  │
│  │  - Serves HTML when read_resource is called               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Tool Definition (MCP Server)
The MCP server defines tools with UI metadata:

```go
// In openshift-mcp-server/pkg/toolsets/core/pods.go
Meta: map[string]interface{}{
    "ui": map[string]interface{}{
        "resourceUri": "ui://pods_list/app.html",
    },
},
```

### 2. Tool Registration (Lightspeed Service)
The LlamaIndex MCP adapter extracts UI metadata:

```python
# In llama_index/tools/mcp/base.py
ui_metadata = None
if hasattr(tool, 'meta') and tool.meta and isinstance(tool.meta, dict):
    ui_info = tool.meta.get('ui')
    if ui_info and isinstance(ui_info, dict):
        ui_metadata = {
            'has_ui': True,
            'resource_uri': ui_info.get('resourceUri'),
        }

# Store on FunctionTool
if ui_metadata:
    function_tool._ui_metadata = ui_metadata
```

### 3. Tool Execution (Lightspeed Service)
When a tool is executed:

```python
# In ols/src/tools/tools.py
ui_metadata = getattr(tool, '_ui_metadata', None)
# ...
return ToolMessage(
    content=tool_output,
    status=status,
    tool_call_id=tool_id,
    additional_kwargs={
        "truncated": was_truncated,
        "ui_metadata": ui_metadata,  # Added here
    },
)
```

### 4. UI Content Fetching (Lightspeed Service)
After tool execution, if UI metadata is present:

```python
# In ols/src/query_helpers/docs_summarizer.py
ui_metadata = tool_call_message.additional_kwargs.get("ui_metadata")
if ui_metadata:
    resource_uri = ui_metadata.get("resource_uri")
    
    # Fetch HTML from MCP server
    result = await mcp_client.read_resource(resource_uri)
    if result and result.contents:
        for content in result.contents:
            if hasattr(content, 'text') and content.text:
                ui_content = content.text
                break
    
    # Stream to console
    yield StreamedChunk(
        type="tool_ui",
        data={
            "id": tool_call_message.tool_call_id,
            "has_ui": True,
            "ui_content": ui_content,  # Full HTML embedded
            "type": "tool_ui",
            "round": i,
        },
    )
```

### 5. SSE Streaming (Lightspeed Service)
The streaming endpoint formats the event:

```python
# In ols/app/endpoints/streaming_ols.py
if event_type == LLM_TOOL_UI_EVENT:
    return f"\nTool UI: {json.dumps(data)}\n"  # For text/plain
# Or for application/json:
# {"event": "tool_ui", "data": {...}}
```

### 6. Console Reception (Lightspeed Console)
The console receives and processes the SSE event:

```typescript
// In lightspeed-console/src/components/Prompt.tsx
} else if (json.event === 'tool_ui') {
  const { has_ui, id, ui_content } = json.data;
  if (has_ui && ui_content) {
    dispatch(chatHistoryUpdateTool(chatEntryID, id, { 
      has_ui, 
      ui_content 
    }));
  }
}
```

### 7. UI Display (Lightspeed Console)
The modal displays the UI:

```typescript
// In lightspeed-console/src/components/ResponseToolModal.tsx
{has_ui && ui_content ? (
  <iframe
    srcDoc={ui_content}
    style={{
      width: '100%',
      height: '500px',
      border: '1px solid var(--pf-t--global--border--color--default)',
      borderRadius: 'var(--pf-t--global--border--radius--small)',
    }}
    title={`${name} UI`}
  />
) : ...}
```

## Modified Files

### Lightspeed Service
1. **llama_index/llama-index-integrations/tools/llama-index-tools-mcp/llama_index/tools/mcp/base.py**
   - Extract UI metadata from `tool.meta.ui`
   - Store as `_ui_metadata` on FunctionTool

2. **ols/src/tools/tools.py**
   - Return ui_metadata tuple from `execute_tool_call()`
   - Add ui_metadata to ToolMessage.additional_kwargs

3. **ols/app/models/models.py**
   - Add `"tool_ui"` to StreamedChunk type literal

4. **ols/src/query_helpers/docs_summarizer.py**
   - Modified `gather_mcp_tools()` to return tuple (tools, mcp_client)
   - Fetch UI content via `mcp_client.read_resource()`
   - Yield StreamedChunk with ui_content

5. **ols/app/endpoints/streaming_ols.py**
   - Add `LLM_TOOL_UI_EVENT` constant
   - Handle tool_ui event in streaming

### Lightspeed Console
1. **src/components/Prompt.tsx**
   - Handle `tool_ui` SSE event
   - Extract and store `ui_content` in Redux

2. **src/components/ResponseToolModal.tsx**
   - Display iframe with `srcDoc={ui_content}`
   - Show collapsible raw output as fallback

3. **src/types.ts**
   - Add `has_ui?: boolean` and `ui_content?: string` to Tool type

### OpenShift MCP Server
Already completed in previous work:
- Tool definitions with `Meta["ui"]["resourceUri"]`
- UI resources embedded via `//go:embed`
- Resource registration in MCP server

## Benefits of This Approach

1. **No Additional Endpoints**: UI content is embedded directly in the streaming response, no need for `/v1/ui-resource` endpoint
2. **Single Round Trip**: UI HTML is fetched once by the backend and included in the stream
3. **Secure**: All MCP communication happens server-side, frontend never directly accesses MCP servers
4. **Efficient**: HTML is only fetched when a UI-enabled tool is actually executed
5. **Fallback Support**: Raw text output is always available alongside the UI

## Testing

### 1. Build and Deploy Updated Services
```bash
# Build lightspeed-service container
cd lightspeed-service
docker build -t quay.io/xrajesh/lightspeed-service:ui-inline .
docker push quay.io/xrajesh/lightspeed-service:ui-inline

# Build lightspeed-console container
cd lightspeed-console
docker build -t quay.io/my-repo/lightspeed-console:ui .
docker push quay.io/my-repo/lightspeed-console:ui
```

### 2. Deploy to OpenShift
Ensure all three components are running:
- openshift-mcp-server:ui (from previous work)
- lightspeed-service:ui-inline
- lightspeed-console:ui

### 3. Test Interactive UI
1. Open the Lightspeed console
2. Ask: "Show me the pods in my cluster"
3. LLM should call the `pods_list` tool
4. Click on the `pods_list` tool label in the response
5. Modal should open showing:
   - Interactive table UI in iframe
   - Collapsible "Show raw output" section below

## Future Enhancements

1. **Bi-directional Communication**: Implement AppBridge protocol for iframe↔console communication
2. **UI Caching**: Cache fetched UI content to avoid repeated MCP calls
3. **Error Handling**: Better error messages when UI fetch fails
4. **Loading States**: Show spinner while UI content is being fetched
5. **Multiple UI Formats**: Support JSON schemas for dynamic UI generation

## Security Considerations

1. **Iframe Sandboxing**: Consider adding `sandbox` attribute to restrict iframe capabilities
2. **Content Security Policy**: UI HTML should not execute arbitrary external scripts
3. **XSS Protection**: UI content is served via `srcDoc`, which provides some isolation
4. **Size Limits**: Consider adding max size limits for ui_content to prevent memory issues
