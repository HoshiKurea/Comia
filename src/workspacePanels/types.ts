import type { Rect } from '../domain/types';
export const PANEL_IDS = ['components','assets','pages','inspector','layers','history','hints'] as const;
export type PanelId = typeof PANEL_IDS[number];
export type DockSide = 'left'|'right';
export const PANEL_LABELS: Record<PanelId,string> = { components:'组件库',assets:'素材库',pages:'页面',inspector:'属性',layers:'图层',history:'历史记录',hints:'快捷键提示' };
export interface PanelGroup { id:string; tabs:PanelId[]; active:PanelId; collapsed:boolean }
export interface DockColumn { width:number; groups:string[]; weights:number[] }
export interface FloatingGroup { groupId:string; rect:Rect }
export interface PanelLayout { version:2; revision:number; groups:Record<string,PanelGroup>; docks:Record<DockSide,DockColumn>; floating:FloatingGroup[]; hidden:PanelId[] }
export type MoveSource = {kind:'tab';panel:PanelId}|{kind:'group';groupId:string};
export type DropTarget = {kind:'float';rect:Rect}|{kind:'merge';groupId:string;index:number}|{kind:'dock';side:DockSide;index:number};
