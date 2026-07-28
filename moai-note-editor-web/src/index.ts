/**
 * moai-note 에디터 임베드 진입점 (I §3).
 *
 * 전역에 MoaiNote 하나만 노출한다. 다른 전역을 만들지 않는다.
 */
import { mount, type Instance, type MountOptions, type Mode, type Theme } from './mount.ts';

export const version = '0.1.0';
export { mount };
export type { Instance, MountOptions, Mode, Theme };

// default export 를 두지 않는다.
// named 와 default 를 섞으면 IIFE 소비자가 MoaiNote.default.mount 로 접근해야 한다 —
// 호스트는 MoaiNote.mount 를 그대로 쓸 수 있어야 한다(I §3.2).
