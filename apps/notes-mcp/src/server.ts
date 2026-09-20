import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotesRepository } from './repository';
import { ProjectionError } from './projection';
import { Observer, observerInstructions } from './observer';

export function createServer(repository: NotesRepository) {
  const server = new McpServer({ name: 'type-notes', version: '0.1.0' }, {
    instructions: observerInstructions + ' Reads are privacy filtered. Editable memory is a separate full-Markdown capability, refused for partially hidden documents. Generic mutations are agent-only; write_memory can update me or agent. Source IDs are opaque; metadata describes identity limitations. Follow nextCursor until null, including empty pages. No writes or migration to stream.'
  });
  const observer = new Observer(repository);
  const scope = z.enum(['stream','me','agent','structure','all']).default('all');
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, 'Invalid date');
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const page = { cursor: z.string().regex(/^\d+$/).max(16).optional(), limit: z.number().int().min(1).max(100).default(25) };
  const result = async (action: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await action()) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof ProjectionError ? error.message : 'Notes request failed.' }] }; }
  };
  server.registerTool('list_notes', { description: 'List opaque note IDs and filtered text previews. Includes safe origin, dates and revisions; no original paths or raw frontmatter.', inputSchema: {...page, scope, from:date.optional(), to:date.optional()}, annotations },
    ({cursor, limit, scope, from, to}) => result(() => repository.list(undefined, Number(cursor ?? 0), limit, {scope,from,to})));
  server.registerTool('read_note', { description: 'Read the complete permitted plain text of a note. Private text is excluded; safe allowlisted metadata is returned.', inputSchema: { id: z.string().uuid() }, annotations },
    ({id}) => result(() => repository.read(id)));
  server.registerTool('search_notes', { description: 'Case-insensitive literal search exclusively over filtered text. Follow nextCursor until null.', inputSchema: { ...page, scope, from:date.optional(), to:date.optional(), query: z.string().trim().min(1).max(1024) }, annotations },
    ({query, cursor, limit, scope, from, to}) => result(() => repository.list(query, Number(cursor ?? 0), limit, {scope,from,to})));
  const path = z.string().min(1).max(1024);
  const writeAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  const agentResult = (action: () => Promise<unknown>) => result(() => repository.agent.run(action));
  server.registerTool('list_agent_folder', { description: 'List notes and subfolders inside agent. Paths are relative to agent.', inputSchema: {path: z.string().max(1024).default('')}, annotations }, ({path}) => agentResult(() => repository.agent.list(path)));
  server.registerTool('read_agent_note', { description: 'Read filtered plain text and a revision for editing a note inside agent.', inputSchema: {path}, annotations }, ({path}) => agentResult(() => repository.agent.read(path)));
  server.registerTool('create_note', { description: 'Create a Markdown note inside agent. Creates parent folders; never overwrites.', inputSchema: {path, content:z.string().max(1048576)}, annotations:{...writeAnnotations,destructiveHint:false} }, ({path,content}) => agentResult(() => repository.agent.createNote(path,content)));
  server.registerTool('create_folder', { description: 'Create a folder and its parents inside agent.', inputSchema:{path}, annotations:{...writeAnnotations,destructiveHint:false,idempotentHint:true} }, ({path}) => agentResult(() => repository.agent.createFolder(path)));
  server.registerTool('update_note', { description: 'Update fully visible agent Markdown with expectedRevision. Hidden documents and removal of existing metadata keys are refused; body-only updates preserve frontmatter. Prefer read_memory(editable=true) and write_memory for history.', inputSchema:{path,content:z.string().max(1048576),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}, annotations:writeAnnotations }, ({path,content,expectedRevision}) => agentResult(() => repository.agent.updateNote(path,content,expectedRevision)));
  for (const kind of ['note','folder'] as const) {
    server.registerTool(`move_${kind}`, { description:`Move or rename an agent ${kind}; both paths are relative to agent. Never overwrites.`, inputSchema:{source:path,destination:path}, annotations:writeAnnotations }, ({source,destination}) => agentResult(() => repository.agent.move(source,destination,kind)));
  }
  server.registerTool('delete_note', {description:'Permanently delete a note inside agent.',inputSchema:{path},annotations:writeAnnotations},({path})=>agentResult(()=>repository.agent.deleteNote(path)));
  server.registerTool('delete_folder', {description:'Permanently delete an agent subfolder. recursive=true deletes its notes and subfolders. The agent root itself cannot be deleted.',inputSchema:{path,recursive:z.boolean().default(false)},annotations:writeAnnotations},({path,recursive})=>agentResult(()=>repository.agent.deleteFolder(path,recursive)));
  const sources = z.array(z.object({id:z.string().uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/)})).max(1000);
  const area = z.enum(['me','agent']);
  const revision = z.string().regex(/^[a-f0-9]{64}$/).optional();
  const moment = z.string().max(40).refine(value => /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value.slice(0,10)).toISOString().slice(0,10) === value.slice(0,10), 'Use an ISO date or timestamp with timezone');
  server.registerTool('prepare_context', {description:'Start a personal session: full overview, corrections, mode instructions and paginated stream/working-memory references. No model runs here.',inputSchema:{mode:z.enum(['review','morning_note','observation','conversation']).default('review'),...page},annotations},
    ({mode,cursor,limit})=>result(()=>observer.prepare(mode,limit,Number(cursor??0))));
  server.registerTool('list_changes', {description:'Compare primary stream sources with a persisted snapshot. Stores inventory only in agent. Follow nextCursor with the returned snapshot and original since. Save actual reviewed sources separately in an artifact.',inputSchema:{since:z.string().regex(/^[a-f0-9]{64}$/).optional(),snapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),...page},annotations:{...writeAnnotations,destructiveHint:false,idempotentHint:true}},
    ({since,snapshot,cursor,limit})=>result(()=>observer.changes(since,snapshot,Number(cursor??0),limit)));
  server.registerTool('read_memory', {description:'Read me or agent. editable=true returns complete Markdown only for fully visible documents; use its revision to update. Hidden or unsupported content is refused for editing.',inputSchema:{area,path,editable:z.boolean().default(false)},annotations},
    ({area,path,editable})=>result(()=>observer.readMemory(area,path,editable)));
  server.registerTool('write_memory', {description:'Create/update me or agent memory, preserving previous versions and recording rationale. Provide expectedRevision to update; omit only for creation. Sources are verified; direct conversation clarifications can use an empty sources list with an explicit reason. Stream is never writable.',inputSchema:{area,path,markdown:z.string().max(1048576),sources,reason:z.string().trim().min(1).max(8000),expectedRevision:revision},annotations:writeAnnotations},
    ({area,path,markdown,sources,reason,expectedRevision})=>result(()=>observer.writeMemory(area,path,markdown,sources,reason,expectedRevision)));
  server.registerTool('save_artifact', {description:'Save a review or useful intermediate analysis in agent. Reuse a stable key for idempotent retries and updates to the same interval. Inputs must cite actually read source revisions. Re-read sources if saving fails. Returns path/revision for future continuation.',inputSchema:{key:z.string().min(1).max(200),kind:z.enum(['review','analysis','morning_note','observation']),body:z.string().min(1).max(800000),sources,expectedRevision:revision,reviewType:z.enum(['day','week','month']).optional(),periodStart:moment.optional(),periodEnd:moment.optional(),partial:z.boolean().default(true),timezone:z.string().max(80).refine(value => {try {new Intl.DateTimeFormat('en',{timeZone:value});return true;} catch {return false;}},'Invalid timezone').default('UTC')},annotations:{...writeAnnotations,idempotentHint:true}},
    input=>result(()=>observer.saveArtifact(input)));
  return server;
}
