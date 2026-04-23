# automaton-Stephen

`automaton-Stephen` is a white-box reconstruction of the `automaton` runtime from the `web4.ai` project family.

This repository is not a random rewrite. It is a structured rebuild of the original agent runtime with the goal of making the system easier to read, understand, and extend while preserving the original product direction:

- autonomous agent runtime
- long-running loop and heartbeat
- model routing and inference budgeting
- multi-layer memory
- orchestration and task graph execution
- replication and child-agent lifecycle
- self-modification, skills, soul, social, and registry systems

At the current stage, this repository reproduces the majority of the original core architecture and main runtime modules, while keeping the codebase readable and easier to study.

## What This Project Is

This project is an experimental autonomous agent runtime built around the idea that an agent is not only a chat interface, but a persistent system with:

- identity
- wallet and resource awareness
- scheduled execution
- memory
- task orchestration
- self-modification
- registry/discovery
- parent-child replication

In practical terms, the runtime is organized into modular subsystems under `src/`, so the full system can be read and reasoned about layer by layer instead of as one opaque monolith.

## Current Scope

This reconstruction currently includes the main runtime subsystems:

- `agent`: context, tool execution, policy engine, spend tracking, loop
- `conway`: sandbox, credits, x402, HTTP client, inference bridge
- `state`: SQLite-backed persistence and schema helpers
- `observability`: logging, metrics, alerts
- `inference`: model registry, budget tracking, routing, provider registry, unified client
- `memory`: working, episodic, semantic, procedural, relationship memory plus ingestion/retrieval
- `orchestration`: planner, task graph, orchestrator, worker routing, messaging
- `replication`: genesis, spawn, lifecycle, health, cleanup, constitution propagation, lineage
- `self-mod`: guarded file editing, audit log, upstream awareness, tool installation helpers
- `skills`: SKILL.md parsing, loading, registration and installation
- `soul`: structured SOUL.md model, validation, update history, reflection
- `heartbeat`: config, tick context, durable scheduler, daemon, built-in tasks
- `social`: signing, validation, relay client, signed message protocol
- `registry`: agent card generation, discovery, ERC-8004 registration helpers
- `survival`: low-compute behavior, resource monitoring, funding strategies
- `git`: state versioning and built-in git tools
- `__tests__`: minimal verification baseline for key runtime behaviors

The only major upstream area intentionally left out is the local `ollama` integration layer.

## Why This Repo Exists

This repository was built as a white-box study and reconstruction effort.

The core idea is simple:

- understanding a complex AI runtime is easier when rebuilding it module by module
- a readable reconstruction is often more useful for learning than passively reading the upstream source
- long multi-turn collaboration with AI can be used not just to generate code, but to progressively understand a system

As a result, this repo serves two roles at once:

1. a functional runtime reconstruction
2. a study-friendly reference implementation of the original system architecture

## Repository Structure

The project is centered around the `src/` directory.

### Core runtime

- `src/agent`
  The runtime brain. Builds prompt/context, executes tools, enforces policy, and runs the main loop.
- `src/inference`
  Selects models, routes requests, enforces budgets, and talks to inference providers.
- `src/state`
  Stores runtime state in SQLite.
- `src/heartbeat`
  Runs scheduled tasks while the agent sleeps.

### Higher-level intelligence

- `src/memory`
  Multi-tier memory and retrieval/ingestion pipeline.
- `src/orchestration`
  Goal decomposition, task graph execution, and multi-agent coordination.
- `src/replication`
  Child agent creation, lifecycle tracking, and lineage management.
- `src/soul`
  Structured self-model and reflection pipeline.

### Extension and evolution layers

- `src/self-mod`
  Safe self-modification and modification auditing.
- `src/skills`
  Plugin-style SKILL.md loading and installation.
- `src/social`
  Signed message transport and relay client logic.
- `src/registry`
  Agent identity card generation, on-chain registration, and discovery.

### Operational layers

- `src/survival`
  Resource-aware degradation and funding behavior.
- `src/git`
  Git helpers for runtime and state versioning.
- `src/observability`
  Logging, metrics, and alerting.

## Project Status

This project should be understood as a strong reconstruction of the core runtime, not as a final polished production release.

What is already true:

- the major runtime modules are present
- the project compiles successfully
- the system architecture is substantially aligned with the upstream design
- key subsystems are split into understandable modules
- a minimal test baseline is included

What is also true:

- the upstream project itself is still evolving
- some areas in this reconstruction are intentionally more conservative or simplified than the upstream implementation
- real-world runtime hardening, edge-case handling, and product polish can still be improved over time

So the best way to think about this repository is:

> a structurally complete, study-friendly, engineering-grade reconstruction of the upstream agent runtime core

## Local Development

### Install

```bash
pnpm install
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm run test
```

### Run the project

```bash
npm run dev
```

## Notes

- This repo assumes a local Node.js/TypeScript environment.
- Some runtime paths expect a `~/.automaton` state directory.
- Several subsystems are designed for persistent or long-running agent behavior, so reading the code by module is often more useful than trying to run everything immediately.

## Recommended Reading Order

If you want to understand the project quickly, a good reading order is:

1. `src/agent`
2. `src/inference`
3. `src/state`
4. `src/memory`
5. `src/orchestration`
6. `src/replication`
7. `src/self-mod`
8. `src/skills`
9. `src/soul`
10. `src/heartbeat`
11. `src/social`
12. `src/registry`

This order follows the runtime from “how the agent thinks” to “how the agent persists, coordinates, evolves, communicates, and survives.”

## Final Summary

`automaton-Stephen` is a substantial white-box rebuild of a forward-looking autonomous agent runtime.

It is useful both as:

- a working reconstruction of the upstream system architecture
- a readable reference for understanding how long-running agent systems can be composed from modular subsystems
