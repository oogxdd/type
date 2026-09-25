import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { brainRequestSchema, jsonContent, mayWriteForRequest } from './brain';
import { OpenAIApi } from './openai-api';

type RunResult = {text:string;model:string;toolsUsed:string[]};
type BrainGateway = Pick<Client,'callTool'>;
const page = fileURLToPath(new URL('./voice.html',import.meta.url));
const script = fileURLToPath(new URL('./voice-client.js',import.meta.url));

function reply(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage, max = 80_000): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON.');
  let size = 0; const chunks: Buffer[] = [];
  for await (const part of request) {
    const chunk = Buffer.from(part); size += chunk.length;
    if (size > max) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function resultFromTool(result: Awaited<ReturnType<BrainGateway['callTool']>>): RunResult {
  const message = jsonContent(result);
  if (!message.content) throw new Error('The brain returned no text.');
  if (message.isError) throw new Error(message.content);
  const data = JSON.parse(message.content) as RunResult;
  if (!data || typeof data.text !== 'string') throw new Error('Invalid brain result.');
  return data;
}

export function createVoiceServer(brain: BrainGateway, openai: Pick<OpenAIApi,'createLiveSession'>) {
  const sessions = new Map<string, number>();
  const delegations = new Map<string, Promise<RunResult>>();
  const server = createServer(async (request,response) => {
    const port = (server.address() as {port:number}|null)?.port;
    const host = `127.0.0.1:${port}`;
    const origin = `http://${host}`;
    if (request.headers.host !== host) { reply(response,403,{error:'Unexpected host.'});return; }
    const url = request.url?.split('?')[0];
    if (request.method === 'GET' && (url === '/' || url === '/voice-client.js')) {
      const body = await readFile(url==='/'?page:script);
      response.writeHead(200, {'Content-Type':url==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(body);return;
    }
    if (request.method !== 'POST' || !['/api/session','/api/run','/api/delegation'].includes(url ?? '')) {
      reply(response,404,{error:'Not found.'});return;
    }
    if (request.headers.origin !== origin) {reply(response,403,{error:'Unexpected origin.'});return;}
    try {
      const body = await readJson(request) as Record<string, unknown>;
      if (url === '/api/session') {
        if (typeof body?.sdp !== 'string') throw new Error('An SDP offer is required.');
        const live = await openai.createLiveSession(body.sdp);
        for (const [id,created] of sessions) if (Date.now()-created > 4*60*60_000) {
          sessions.delete(id);
          for (const key of delegations.keys()) if (key.startsWith(id+':')) delegations.delete(key);
        }
        sessions.set(live.session.id,Date.now());
        reply(response,201,live);return;
      }
      const raw = url === '/api/delegation' ? body?.task : body;
      const parsed = brainRequestSchema.parse(raw);
      // A direct instruction in the current request takes precedence over the UI switch.
      const task = {...parsed, allowWrites:mayWriteForRequest(parsed)};
      const run = async () => resultFromTool(await brain.callTool({name:'run_personal_agent',arguments:task}));
      if (url === '/api/run') {reply(response,200,await run());return;}
      const sessionId = body?.sessionId;
      const delegationId = body?.delegationId;
      if (typeof sessionId !== 'string' || !sessions.has(sessionId) || Date.now() - sessions.get(sessionId)! > 4*60*60_000 ||
        typeof delegationId !== 'string' || !/^item_[a-zA-Z0-9_-]{4,128}$/.test(delegationId))
        throw new Error('Unknown Live delegation.');
      const key = `${sessionId}:${delegationId}`;
      if (!delegations.has(key)) delegations.set(key,run());
      reply(response,200,await delegations.get(key));
    } catch (error) {
      reply(response,400,{error:error instanceof Error?error.message:'Request failed.'});
    }
  });
  return server;
}
