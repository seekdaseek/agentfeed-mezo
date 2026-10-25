// Starts src/mcp.js over stdio exactly as an MCP host would, lists tools, calls list_routes and one paid route.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const route = process.argv[2] || 'sol-price';
const transport = new StdioClientTransport({ command: 'node', args: ['src/mcp.js'], env: { ...process.env } });
const client = new Client({ name: 'smoke', version: '0.0.1' });
await client.connect(transport);
const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));
const routes = await client.callTool({ name: 'list_routes', arguments: {} });
console.log('list_routes ->', JSON.parse(routes.content[0].text).routes.length, 'routes');
const call = await client.callTool({ name: 'call_route', arguments: { route } });
console.log('call_route isError =', !!call.isError);
console.log(call.content[0].text.slice(0, 700));
await client.close();
