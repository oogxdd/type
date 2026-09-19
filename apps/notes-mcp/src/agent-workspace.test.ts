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
