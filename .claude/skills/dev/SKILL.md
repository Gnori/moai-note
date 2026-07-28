---
name: dev
description: Unified shortcut for development process commands. Delegates to dev-req (requirements + artifacts) with simple shortcuts like /dev init, /dev req, /dev artifact, /dev status
---

# Dev - Development Process Shortcuts

Unified command dispatcher for development process management. Provides simple shortcuts to the `dev-req` (requirements) skill.

> 개발 표준 프로세스의 정본은 [/DEV_PROCESS.md](../../../DEV_PROCESS.md)이며, 이 스킬은 그 표준의 산출물 R(요구사항)·I(인터페이스 계약)·P(구현 플랜)·W(검증 보고)·D(대시보드)를 만드는 레퍼런스 구현이다.
> (2026-07-07: 동일 프리픽스 평면 파일 체계 + `/dev artifact <i|p|w>` 추가 — 산출물을 요구사항과 같은 디렉토리에 응집)
> (2026-07-03: dev-project-auto-doc 스킬 및 `/dev doc` 명령 제거, 요구사항 위치 `docs/requirements/`로 이동)

## Quick Reference

| Shortcut | Full Command | Description |
|----------|--------------|-------------|
| `/dev init` | `/dev-req init` | Initialize requirements structure |
| `/dev req <name>` | `/dev-req create <name>` | Create `[프리픽스]_<이름>_req.md` |
| `/dev artifact <i\|p\|w>` | `/dev-req artifact <i\|p\|w>` | Create I/P/W with same prefix, same directory |
| `/dev i` / `/dev p` / `/dev w` | `/dev-req artifact i\|p\|w` | Artifact shortcuts |
| `/dev status` | `/dev-req progress-report` | Show progress report (+artifact presence) |

---

## Commands

### init

Initialize requirements management structure.

```bash
/dev init [--force]
```

Creates `docs/requirements/` with templates (R 3종 + I/P/W 3종) and updates CLAUDE.md.

### req

Create a new requirement spec file.

```bash
/dev req <requirement_name> [--priority=높음|중간|낮음] [--scale=simple|standard|complex] [--type=feature|enhance|perf|bug] [--id=<도메인코드>]
# --scale = 프로세스 게이팅 축 (산출물 수·게이트), --type = 내용 가이드 축 (R 1장 관점 블록)
# 둘 다 생략 시 이름 키워드로 자동 추천
```

### artifact

Create an artifact document with the same prefix in the same directory.

```bash
/dev artifact <i|p|w> [--req=<파일명 일부>] [--module=<모듈명>]
# i = <프리픽스>_<이름>_interface-design.md (다중 모듈 시 1건, 승인(G2) 후 P 진행)
# p = <프리픽스>_<이름>-<모듈>_dev-plan.md  (--module 필수, 모듈당 1건)
# w = <프리픽스>_<이름>-<모듈>_walkthrough.md (--module 필수, P당 1건 — W 없이 검증완료 금지)
```

### status

Show progress report for current requirement.

```bash
/dev status [--format=markdown|json]
```

---

## Typical Workflow

```bash
# 1. Create requirement (R — G1: 2장 확정)
/dev req user-authentication --scale=standard --id=1026

# 2. Interface contract (다중 모듈 시 — G2 승인)
/dev artifact i

# 3. Per-module plan → implement
/dev artifact p --module=seed-ai-user-api

# 4. Walkthrough (P당 1건 — G3/G4)
/dev artifact w --module=seed-ai-user-api

# 5. Check progress
/dev status
```

산출물은 모두 `docs/requirements/`에 동일 프리픽스(`[YYYYMMDD-HHMMSS-코드]_`)로 응집되며, 완료 시 프리픽스 세트째 `archive/`로 이동한다. 舊 `docs/interface_design_and_dev_plans/`는 동결(레거시) — 신규 작성 금지.

---

## Notes

- All commands delegate to the `dev-req` skill
- `/dev` without arguments shows help
- CLAUDE.md is automatically backed up before modifications
