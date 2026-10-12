import {it,expect} from 'vitest';
import {createProject,createLayer} from '../../src/domain/factories';
import {validateProject} from '../../src/domain/validate';
it('format9 preserves independent word wrapping, invalid modes and version8 refuse it',()=>{const p=createProject(),pid=p.pageOrder[0],t=createLayer('text',pid);if(t.type!=='text')throw Error('text');t.text.wrapMode='word';p.layers[t.id]=t;p.pages[pid].roots.push(t.id);expect(validateProject(p)).toMatchObject({ok:true,value:{layers:{[t.id]:{text:{wrapMode:'word'}}}}});t.text.wrapMode='invalid' as 'word';expect(validateProject(p).ok).toBe(false);t.text.wrapMode='word';p.schemaVersion=8;expect(validateProject(p).ok).toBe(false);});
