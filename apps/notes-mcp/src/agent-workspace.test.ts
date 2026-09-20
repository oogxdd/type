import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, symlink, link, rm, readdir } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentWorkspace } from './agent-workspace';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'agent-workspace-')));roots.push(root);return {root,agent:new AgentWorkspace(root)};}
it('creates, reads, updates, moves, lists and deletes nested notes and folders',async()=>{
 const {root,agent}=await fixture();
 expect(await agent.list()).toEqual({entries:[]});
 await agent.createFolder('ideas/nested');
 await agent.createNote('ideas/nested/a.md','# First');
 const read=await agent.read('ideas/nested/a.md');expect(read.content).toBe('First');
 await agent.updateNote(read.path,'# Second',read.revision);
 await expect(agent.updateNote(read.path,'stale',read.revision)).rejects.toThrow('Revision conflict');
 await expect(agent.createNote(read.path,'overwrite')).rejects.toThrow();
 await agent.move(read.path,'ideas/b.md','note');
 await agent.move('ideas','archive','folder');
 expect((await agent.list('archive')).entries.map(e=>e.path)).toEqual(['archive/b.md','archive/nested']);
 expect(await readFile(join(root,'_system/agent/archive/b.md'),'utf8')).toBe('# Second');
 await expect(agent.deleteFolder('archive',false)).rejects.toThrow();
 await agent.deleteNote('archive/b.md');await agent.deleteFolder('archive',true);
 expect(await readdir(join(root,'_system/agent'))).toEqual([]);
});
it('cannot escape agent with source, destination, reads, updates or deletes',async()=>{
 const {root,agent}=await fixture();await writeFile(join(root,'outside.md'),'KEEP');
 await agent.createNote('safe.md','safe');const revision=(await agent.read('safe.md')).revision;
 for(const path of ['../outside.md','/tmp/outside.md','nested/../../outside.md','..\\outside.md','C:\\outside.md','.git/config.md','x/./y.md','']){
  for(const action of [()=>agent.createNote(path,'BAD'),()=>agent.read(path),()=>agent.updateNote(path,'BAD',revision),()=>agent.deleteNote(path),()=>agent.createFolder(path),()=>agent.deleteFolder(path,true),()=>agent.move('safe.md',path,'note'),()=>agent.move(path,'new.md','note')]) await expect(action()).rejects.toThrow();
 }
 expect(await readFile(join(root,'outside.md'),'utf8')).toBe('KEEP');
 expect((await agent.read('safe.md')).content).toBe('safe');
});
it('rejects symlinked agent root, nested links, file links and hardlinks',async()=>{
 const {root,agent}=await fixture();const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'private.md'),'KEEP');
 await mkdir(join(root,'_system'));await symlink(outside,join(root,'_system/agent'));await expect(agent.createNote('private.md','BAD')).rejects.toThrow();await expect(agent.deleteFolder('nested',true)).rejects.toThrow();await rm(join(root,'_system/agent'));
 await agent.createFolder('nested');await symlink(outside,join(root,'_system/agent/nested/link'));
 await expect(agent.createNote('nested/link/private.md','BAD')).rejects.toThrow();
 await expect(agent.deleteFolder('nested',true)).rejects.toThrow();
 await symlink(join(outside,'private.md'),join(root,'_system/agent/link.md'));
 await link(join(outside,'private.md'),join(root,'_system/agent/hard.md'));
 for(const path of ['link.md','hard.md']){
  await expect(agent.read(path)).rejects.toThrow();await expect(agent.deleteNote(path)).rejects.toThrow();await expect(agent.move(path,'moved.md','note')).rejects.toThrow();
 }
 expect(await readFile(join(outside,'private.md'),'utf8')).toBe('KEEP');
});
it('never overwrites move destinations and refuses folder self-moves',async()=>{
 const {agent}=await fixture();await agent.createNote('a.md','A');await agent.createNote('b.md','B');
 await expect(agent.move('a.md','b.md','note')).rejects.toThrow('exists');
 expect((await agent.read('b.md')).content).toBe('B');
 await agent.createFolder('x');await expect(agent.move('x','x/y','folder')).rejects.toThrow();
});
it('supports only the configured legacy and system memory boundaries',async()=>{
 const {root}=await fixture();
 for(const prefix of [['agent'],['me'],['_system','agent'],['_system','me']]){
  const workspace=new AgentWorkspace(root,prefix);
  await workspace.createNote('context.md','# Context');
  expect(await readFile(join(root,...prefix,'context.md'),'utf8')).toBe('# Context');
 }
 for(const prefix of [[],['stream'],['..','agent'],['_system/agent'],['agent','nested']])
  expect(()=>new AgentWorkspace(root,prefix)).toThrow('Unsupported memory');
});
it('roundtrips full Markdown with metadata and preserves metadata on body updates',async()=>{
 const {root,agent}=await fixture();
 const original='---\nid: stable\ncreated_ms: 1\nupdated_ms: 2\nsources: ["notes://abc"]\n---\n# Context\n\n[Source](notes://abc)';
 await agent.createNote('context.md',original);
 const edit=await agent.readEditable('context.md');
 expect(edit.markdown).toBe(original);expect((await agent.read('context.md')).editable).toBe(true);
 await agent.updateNote('context.md',edit.markdown.replace('updated_ms: 2','updated_ms: 3').replace('# Context','# Updated'),edit.revision);
 const second=await agent.readEditable('context.md');
 await expect(agent.updateNote('context.md','---\nid: stable\n---\nOops',second.revision)).rejects.toThrow('retain');
 await agent.updateNote('context.md','# Body only',second.revision);
 expect(await readFile(join(root,'_system/agent/context.md'),'utf8')).toContain('sources: ["notes://abc"]\n---\n# Body only');
});
it('does not replace partially visible notes with their projected text',async()=>{
 const {root,agent}=await fixture();
 for(const [index,original] of [
  '# Visible\n\n::: #skip-ai\nHidden\n:::',
  '---\ntags: [skip-ai]\n---\nHidden',
  '# Visible\n\nA prose mention of #skip-ai',
  '# Visible\n\n<span data-tag-attrs="#&#115;kip-ai">Hidden</span>',
  '# Visible\n\ntype_annotations_b64: abcdefghijklmnop',
 ].entries()){
  const path=`private-${index}.md`;
  await agent.createNote(path,original);
  const read=await agent.read(path);expect(read.editable).toBe(false);
  await expect(agent.readEditable(path)).rejects.toThrow();
  await expect(agent.updateNote(path,read.content,read.revision)).rejects.toThrow();
  expect(await readFile(join(root,'_system/agent',path),'utf8')).toBe(original);
 }
 await agent.createNote('legacy.md','#nontake\nHidden');
 await expect(agent.read('legacy.md')).rejects.toThrow('Private');
 await expect(agent.readEditable('legacy.md')).rejects.toThrow();
});
it('refuses full editable reads of encrypted or malformed documents',async()=>{
 const {agent}=await fixture();
 for(const [index,markdown] of ['NV_ENC_V1: secret','---\nid: never closed','::: not a valid tag !!!\nhidden'].entries()){
  const path=`invalid-${index}.md`;await agent.createNote(path,markdown);
  await expect(agent.readEditable(path)).rejects.toThrow();
 }
});
