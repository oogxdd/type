import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotesRepository } from './repository';
import { ProjectionError } from './projection';
import { Observer, observerInstructions, memoryInstructions } from './observer';
import { References } from './references';
import { documentMarkdown, validDocumentMoment } from './document-metadata';

export function createServer(repository: NotesRepository) {
  const server = new McpServer({ name: 'type-notes', version: '0.2.0' }, {
    instructions: observerInstructions + ' ' + memoryInstructions + ' Reads are privacy filtered. Editable memory is a separate full-Markdown capability, refused for partially hidden documents. Generic mutations are agent-only; write_memory updates me/agent and save_artifact writes reviews. Source IDs are opaque; metadata describes identity limitations. Follow nextCursor until null, including empty pages. No writes or migration to stream.'
  });
  const observer = new Observer(repository);
  const references = new References(repository);
  const scope = z.enum(['stream','me','agent','reviews','structure','all']).default('all');
  const reviewType = z.enum(['day','week','month','quarter','year','period']);
  const kind = z.enum(['primary','derived','review','profile','working','instructions','structure']);
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, 'Invalid date');
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const page = { cursor: z.string().regex(/^\d+$/).max(16).optional(), limit: z.number().int().min(1).max(100).default(25) };
  const result = async (action: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await repository.run(action)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof ProjectionError ? error.message : 'Notes request failed.' }] }; }
  };
  const filters = {scope, from:date.optional(), to:date.optional(), kind:kind.optional(), reviewType:reviewType.optional()};
  server.registerTool('list_notes', { description: 'List filtered previews and safe metadata. Review date filters select overlapping periods, including legacy reviews. No source filenames or raw frontmatter.', inputSchema: {...page, ...filters}, annotations },
    ({cursor, limit, ...filters}) => result(() => repository.list(undefined, Number(cursor ?? 0), limit, filters)));
  server.registerTool('read_note', { description: 'Read the complete permitted plain text of a note. Private text is excluded; safe allowlisted metadata is returned.', inputSchema: { id: z.string().uuid() }, annotations },
    ({id}) => result(() => repository.read(id)));
  server.registerTool('search_notes', { description: 'Case-insensitive literal search exclusively over filtered text. Follow nextCursor until null.', inputSchema: { ...page, ...filters, query: z.string().trim().min(1).max(1024) }, annotations },
    ({query, cursor, limit, ...filters}) => result(() => repository.list(query, Number(cursor ?? 0), limit, filters)));
  const documentId = z.string().uuid();
  const selection = {heading:z.string().min(1).max(512).optional(), startLine:z.number().int().min(1).optional(), endLine:z.number().int().min(1).optional()};
  const revision = z.string().regex(/^[a-f0-9]{64}$/).optional();
  server.registerTool('read_document', {description:'Read a permitted document, heading or line range with numbered lines, outline and safe internal links. Line numbers belong to this filtered revision, not the raw file.', inputSchema:{id:documentId,...selection},annotations},
    ({id,...selection})=>result(()=>references.readDocument(id,selection)));
  server.registerTool('create_reference', {description:'Create a portable document/heading navigation link or a revision-pinned citation. Citations require expectedRevision from read_note/read_document. Missing or duplicate UUIDs cannot produce portable references.', inputSchema:{id:documentId,kind:z.enum(['navigation','citation']).default('citation'),expectedRevision:revision,...selection},annotations},
    ({id,kind,expectedRevision,...selection})=>result(()=>references.create(id,kind,selection,expectedRevision)));
  server.registerTool('resolve_reference', {description:'Resolve a type-note URI through the current privacy filter. Reports changed, unavailable or target_unavailable instead of guessing a citation target.',inputSchema:{uri:z.string().max(4096)},annotations},
    ({uri})=>result(()=>references.resolve(uri)));
  server.registerTool('check_dependencies', {description:'Check the direct evidence/context dependencies recorded in a document. Follow derived sources separately to check deeper ancestry. Does not generate or update anything.',inputSchema:{id:documentId},annotations},
    ({id})=>result(()=>references.checkDependencies(id)));
  const path = z.string().min(1).max(1024);
  const writeAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  const agentResult = (action: () => Promise<unknown>) => result(() => repository.agent.run(action));
  server.registerTool('list_agent_folder', { description: 'List notes and subfolders inside agent. Paths are relative to agent.', inputSchema: {path: z.string().max(1024).default('')}, annotations }, ({path}) => agentResult(() => repository.agent.list(path)));
  server.registerTool('read_agent_note', { description: 'Read filtered plain text and a revision for editing a note inside agent.', inputSchema: {path}, annotations }, ({path}) => agentResult(() => repository.agent.read(path)));
  server.registerTool('create_note', { description: 'Create a Markdown note with UUID inside agent. Creates parent folders; never overwrites.', inputSchema: {path, content:z.string().max(1048576)}, annotations:{...writeAnnotations,destructiveHint:false} }, ({path,content}) => agentResult(() => repository.agent.createNote(path,documentMarkdown(content))));
  server.registerTool('create_folder', { description: 'Create a folder and its parents inside agent.', inputSchema:{path}, annotations:{...writeAnnotations,destructiveHint:false,idempotentHint:true} }, ({path}) => agentResult(() => repository.agent.createFolder(path)));
  server.registerTool('update_note', { description: 'Update fully visible agent Markdown with expectedRevision. Hidden documents and removal of existing metadata keys are refused; body-only updates preserve frontmatter. Prefer read_memory(editable=true) and write_memory for history.', inputSchema:{path,content:z.string().max(1048576),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}, annotations:writeAnnotations }, ({path,content,expectedRevision}) => agentResult(() => repository.agent.updateNote(path,content,expectedRevision)));
  for (const kind of ['note','folder'] as const) {
    server.registerTool(`move_${kind}`, { description:`Move or rename an agent ${kind}; both paths are relative to agent. Never overwrites.`, inputSchema:{source:path,destination:path}, annotations:writeAnnotations }, ({source,destination}) => agentResult(() => repository.agent.move(source,destination,kind)));
  }
  server.registerTool('delete_note', {description:'Permanently delete a note inside agent.',inputSchema:{path},annotations:writeAnnotations},({path})=>agentResult(()=>repository.agent.deleteNote(path)));
  server.registerTool('delete_folder', {description:'Permanently delete an agent subfolder. recursive=true deletes its notes and subfolders. The agent root itself cannot be deleted.',inputSchema:{path,recursive:z.boolean().default(false)},annotations:writeAnnotations},({path,recursive})=>agentResult(()=>repository.agent.deleteFolder(path,recursive)));
  const sources = z.array(z.object({id:documentId,revision:z.string().regex(/^[a-f0-9]{64}$/),role:z.enum(['evidence','context']).optional()})).max(1000);
  const area = z.enum(['me','agent','reviews']);
  const retainHistory = z.boolean().default(false);
  const moment = z.string().max(40).refine(validDocumentMoment, 'Use a valid ISO date or timestamp with timezone');
  server.registerTool('prepare_context', {description:'Start a session with complete filtered instructions, map index, corrections and references. Explicit summarySize selects me/summaries; omission retains legacy overview. Missing/unavailable summaries are explicit. No context recipe or model runs here.',inputSchema:{mode:z.enum(['review','morning_note','observation','conversation']).default('review'),summarySize:z.enum(['short','medium','large']).optional(),...page},annotations},
    ({mode,cursor,limit,summarySize})=>result(()=>observer.prepare(mode,limit,Number(cursor??0),summarySize)));
  server.registerTool('list_changes', {description:'Compare primary stream sources with a persisted snapshot. Stores inventory only in agent. Follow nextCursor with the returned snapshot and original since. Save actual reviewed sources separately in an artifact.',inputSchema:{since:z.string().regex(/^[a-f0-9]{64}$/).optional(),snapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),...page},annotations:{...writeAnnotations,destructiveHint:false,idempotentHint:true}},
    ({since,snapshot,cursor,limit})=>result(()=>observer.changes(since,snapshot,Number(cursor??0),limit)));
  server.registerTool('list_memory_folder', {description:'Browse permitted Markdown memory in me, agent or reviews. Paths are relative to the selected area. Folders appear when they contain visible documents; internal state/history is excluded.',inputSchema:{area,path:z.string().max(1024).default(''),...page},annotations},
    ({area,path,cursor,limit})=>result(()=>observer.listMemory(area,path,Number(cursor??0),limit)));
  server.registerTool('move_memory', {description:'Move/rename a note or folder within one memory area; never overwrites. Note moves require expectedRevision from read_memory. Portable identity survives the move.',inputSchema:{area,source:path,destination:path,kind:z.enum(['note','folder']).default('note'),expectedRevision:revision},annotations:writeAnnotations},
    ({area,source,destination,kind,expectedRevision})=>result(()=>observer.moveMemory(area,source,destination,kind,expectedRevision)));
  server.registerTool('delete_memory', {description:'Delete one fully readable memory document with its edit revision. References then become unavailable. retainHistory optionally keeps the previous document; Git is the main history. Stream is excluded.',inputSchema:{area,path,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),retainHistory},annotations:writeAnnotations},
    ({area,path,expectedRevision,retainHistory})=>result(()=>observer.deleteMemory(area,path,expectedRevision,retainHistory)));
  server.registerTool('read_memory', {description:'Read me, agent or reviews. editable=true returns full safe Markdown and an edit revision. The separate source field has the ID/revision for citations and dependencies. Private or unsupported edits are refused.',inputSchema:{area,path,editable:z.boolean().default(false)},annotations},
    ({area,path,editable})=>result(()=>observer.readMemory(area,path,editable)));
  server.registerTool('write_memory', {description:'Create/update me or agent with UUID, verified evidence/context dependencies and rationale. expectedRevision is the edit revision. Git is the main history; retainHistory optionally copies the old document. Direct conversation clarifications may have empty sources and explicit reason.',inputSchema:{area:z.enum(['me','agent']),path,markdown:z.string().max(1048576),sources,reason:z.string().trim().min(1).max(8000),expectedRevision:revision,retainHistory},annotations:writeAnnotations},
    ({area,path,markdown,sources,reason,expectedRevision,retainHistory})=>result(()=>observer.writeMemory(area,path,markdown,sources,reason,expectedRevision,retainHistory)));
  server.registerTool('save_artifact', {description:'Save reviews in reviews/<period>/ and analyses in agent. Stable keys make retries idempotent even after a move; old agent artifacts update in place. Declare period and actual coverage; partial defaults true. Complete reviews without narrower coverage declare the full period. Supply actually read source revisions and evidence/context roles.',inputSchema:{key:z.string().min(1).max(200),kind:z.enum(['review','analysis','morning_note','observation']),body:z.string().min(1).max(800000),sources,expectedRevision:revision,retainHistory,reviewType:reviewType.optional(),periodStart:moment.optional(),periodEnd:moment.optional(),coverageStart:moment.optional(),coverageEnd:moment.optional(),partial:z.boolean().default(true),timezone:z.string().max(80).refine(value => {try {new Intl.DateTimeFormat('en',{timeZone:value});return true;} catch {return false;}},'Invalid timezone').default('UTC')},annotations:{...writeAnnotations,idempotentHint:true}},
    input=>result(()=>observer.saveArtifact(input)));
  return server;
}
