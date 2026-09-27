# jev-agent-hooks

Hooks that put [TypeSafe Jev](https://docs.typesafe.ai) in two places in a coding agent's loop:
picking which skill to load for a turn, and picking which model a subagent gets. One shared
implementation runs on Claude Code, Codex, and [pi](https://github.com/badlogic/pi-mono).

Every hook fails open. A Jev outage, a missing API key, or a bad response lets the turn through.

## What is in here

### Skill suggestion

`hooks/jev-skill-suggest.mjs` runs on every user prompt, follows the
[skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion), and makes two
Jev requests:

1. A Choice over the whole skill roster, with each skill's description as its criteria, plus
   three Noul questions asking whether the turn wants an action at all.
2. A Choice over the top 3, this time with 700 characters of each `SKILL.md` body, plus one
   "does this skill do the thing that was asked" Noul per candidate.

If the best fit Noul clears 0.7, the hook injects one line naming the skill, in the cookbook's
wording, which says the suggestion can be ignored. The agent still decides.

Each host builds its own roster. Claude reads `~/.claude/skills`, the project's `.claude/skills`,
and enabled plugins, and drops anything turned off in `skillOverrides`. Codex reads
`~/.agents/skills`, `~/.codex/skills`, and every `.agents/skills` from the working directory up
to the repository root. pi hands over the skill list it already resolved.

### Subagent routing

Two gates run before a subagent starts, and they do different jobs.

`hooks/subagent-model-gate.mjs` is the rule layer. It denies a subagent with no explicit `model`,
a model outside `haiku|sonnet|opus|fable`, a concrete model id instead of an alias, and a preset
agent paired with the wrong model. `sonnet` carries no extra admission test; it routes like any
other tier. For a Workflow script it scans
every `agent()` call site and requires a literal `model`, with a small JavaScript scanner that
tracks string and comment state so an `agent(` inside a string does not count. The policy it
enforces is `skills/claude-subagent-model/SKILL.md`.

`hooks/jev-agent-gate.mjs` is the semantic layer. It asks Jev two questions: is this agent suited
to this task (Noul, needs a readable agent description), and which model tier does the task need
(Choice, criteria taken from the same policy). It denies when fit drops below 0.2, or when Jev
picks a different tier with confidence at or above 0.5 while giving the requested tier under 0.15.

Each host only asks what its own routing policy leaves open. Claude gets fit plus the four Claude
tiers. pi gets fit plus the `luna`/`sol`/`astra` worker tiers. Codex gets fit only, because its
role TOML pins model and effort ahead of the spawn parameters.

A denial fires at most once per session, agent, and tier. Resubmitting the same call unchanged
goes through, so a wrong Jev answer cannot trap the main loop.

`hooks/subagent-return-gate.mjs` is unrelated to Jev but belongs to the same policy: it blocks a
subagent from stopping with an empty final message, because that message is the whole deliverable.

### The `jev` CLI and the `jev-decide` skill

`hooks/jev-cli.mjs` installs as `jev` and turns one JSON request into typed answers, so any agent
can ask Jev on its own initiative instead of waiting for a hook. `skills/jev-decide/SKILL.md`
tells the agent when that is worth doing: ranking more candidates than it can read, deciding
between acting and asking on an ambiguous instruction, and checking that the evidence supports a
claim before reporting work as done.

### Preset agents

`agents/{mech,bulk,deep,oracle}.md` exist because the Agent tool has no effort parameter, so effort
has to come from an agent definition. `mech` is haiku at low effort, `bulk` is sonnet at medium —
bounded repetition under a supplied pattern, and the preset to reach for when you want sonnet
capped rather than inheriting the session's effort — `deep` is opus at xhigh, `oracle` is fable at xhigh — a read-only advisor for hard calls, not a builder. The rule gate enforces the
pairing.

## Requirements

Node 20 or newer, and `TYPESAFE_API_KEY` in the environment the agent starts from.

## Install

```bash
git clone https://github.com/onlyjq04/jev-agent-hooks ~/workspace/jev-agent-hooks
cd ~/workspace/jev-agent-hooks && ./install.sh
```

`install.sh` symlinks the files into `~/.claude/hooks`, `~/.claude/skills`, `~/.claude/agents`,
`~/.agents/skills`, `~/.local/bin/jev`, and `~/.pi/agent/extensions` when pi is installed, so
`git pull` updates all of them. It does not edit any settings file.

Register the hooks yourself:

- Claude Code: merge `config/claude-settings.snippet.json` into `~/.claude/settings.json`.
- Codex: merge `config/codex-hooks.snippet.json` into `~/.codex/hooks.json`, then trust the file
  with `/hooks`. Without the trust step nothing runs.
- pi: nothing to do. Extensions load from `~/.pi/agent/extensions`.

Both snippets write the hook command with `$HOME`, which Claude Code and Codex expand because
they run the command through a shell. Substitute an absolute path if yours does not.

## Configuration

| Variable | Values | Effect |
|---|---|---|
| `TYPESAFE_API_KEY` | key | Required. Absent means every hook passes through. |
| `JEV_SKILL_SUGGEST` | `on` (default), `shadow`, `off` | `shadow` logs the pick without injecting it. |
| `JEV_AGENT_GATE` | `enforce` (default), `shadow`, `off` | `shadow` logs a would-be denial without denying. |
| `CLAUDE_SUBAGENT_MODEL_GATE` | `on`, `off` | Overrides the rule gate's own applicability check. |

The thresholds are constants at the top of each hook: `FITS_THRESHOLD` and `GATE_THRESHOLD` in
the suggester, `FIT_MIN`, `TIER_MIN_CONFIDENCE`, and `TIER_REQUESTED_MAX` in the Jev gate.

Every hook appends one JSON line per call to `~/.claude/logs/`: `jev-skill-suggest.jsonl`,
`jev-agent-gate.jsonl`, `jev-cli.jsonl`. The CLI log records question ids and answers, never the
state that was sent.

## What the offline evaluation showed

The numbers come from replaying real sessions, not from a benchmark. They are small, and they
describe one person's skill set and one person's habits.

**Skill suggestion, 34 real turns.** The cookbook's 0.3 fit threshold suggested a skill on 15 of
the 16 turns where the agent had loaded none. Raising it to 0.7 cut that to 3 and kept every pick
that agreed with what the agent had chosen for itself. The three-Noul gate barely separates
anything in a coding agent, because nearly every request acts on the user's files: the two classes
scored 0.44 to 0.92 and overlapped. The fit threshold does the work, and the gate mostly idles.

Read the labels with care. The "correct" skill in that replay is whatever the agent loaded at the
time, which is not ground truth. On three turns Jev looked more right than the agent, including
one where the user said "diagnose" and the agent had loaded a browser skill.

Two known failure modes. A roster with near-duplicate skills splits its own probability, so
`diagnose` and `diagnosing-bugs` take votes from each other. And short generic phrasing misfires:
"record this as a todo" pulled a DingTalk todo skill at fit 0.74.

The hook also departs from the cookbook by never injecting a "nothing relevant" line. Claude Code's
built-in skills have no `SKILL.md`, so they are missing from the roster, and saying nothing is
relevant would talk the agent out of them.

**Subagent gate, 20 historical dispatches.** Nine would have been denied. Three were an old agent
shell that no longer exists. Two were clearly right, including a replay task sent to opus when the
prompt had already decided everything, and an evaluation task sent to fable. Three sit on the
haiku and sonnet boundary and are arguable. The fit question never fired, which matches its job:
0.2 is a floor for a badly mismatched agent, not a quality bar.

**Latency.** The suggester takes 2 to 3 seconds per turn against the live API, with an offline p50
near 1 second, because it makes two round trips. The dispatch gate takes about 400 ms.

## Known rough edges

Codex encrypts `spawn_agent.message` in some builds. The gate skips a payload that starts with
`gAAAAA` rather than asking Jev to judge ciphertext.

`pi -p` reads stdin until EOF when stdin is not a TTY, so run it with `< /dev/null` from a tool.
That is pi's behavior, not this extension's, but it looks like a hang in the extension.

Everything in a Jev `state` goes to api.typesafe.ai. The hooks send prompts, agent descriptions,
and skill descriptions. Do not put secrets in an agent prompt.

## Layout

```
hooks/      jev-lib.mjs, jev-skill-suggest.mjs, jev-agent-gate.mjs, jev-cli.mjs,
            subagent-model-gate.mjs, subagent-return-gate.mjs
skills/     jev-decide, claude-subagent-model
agents/     mech.md, bulk.md, deep.md, oracle.md
pi/         before_agent_start and tool_call extensions that import the shared hooks
config/     hook registrations to merge into the host's settings
```

The denial messages are in Chinese, because that is the language of the sessions they were written
for. Rewrite them in the two gates if that does not suit you.

## License

MIT
