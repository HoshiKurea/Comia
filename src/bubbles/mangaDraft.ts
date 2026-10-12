import type { Project } from '../domain/types';
import { migrateProject } from '../storage/migrateProject';

/** The first new manga edit can upgrade a parked legacy document in that same transaction. */
export function promoteMangaDraft(draft:Project):void{
  if(draft.schemaVersion>=6)return;
  const upgraded=migrateProject(draft);if(!upgraded.ok)throw Error(upgraded.problems.map(p=>p.message).join('；'));
  Object.assign(draft,upgraded.value);
}
