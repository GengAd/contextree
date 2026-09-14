# contextree

**English** · [Français](README.fr.md)

A **context tree** for working with an AI: small typed branches — identity, rules, context, references, skills — of which only the relevant ones are injected on each call.

Like a `CLAUDE.md`, but **routed**: on every prompt, a lightweight AI call reads each branch's load condition (`load_when`: "load me when…") and keeps only what helps. And **shareable**: the source of truth is markdown in `.contextree/`, and git is enough to share it.

## Getting started

The package is not published on npm yet. From the repository:

```bash
npm install
npm run build
npm i -g .          # or npm link
```

Then, in the project to equip:

```bash
contextree init      # creates .contextree/ with a starter tree
# edit the branches, especially their load_when
contextree install   # wires the detected agents
```

Restart your agent. **No API key is needed**: if an agent CLI (`claude`, `codex`, `gemini`) is installed, your subscription does the routing. A key (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_BASE_URL` if needed) is used when present — it is just faster.

**Language**: the tool speaks English or French — CLI, extension, and what the AI reads. It follows the system language (VS Code's for the extension); `--lang fr|en` or `CONTEXTREE_LANG` set it. The content of your branches is never translated.

`contextree install` writes **the command that is running**: absolute paths to the local binary while the package is unpublished, the `npx` form afterwards. `contextree install --status` shows it without writing anything.

## Commands

```bash
contextree list                      # the tree
contextree route "<prompt>"          # what the router would load, and why
contextree render                    # the whole tree, no routing
contextree add --title "…" --type rule --load-when "…"
contextree rm <path>
contextree export --token            # a token to paste into a chat
contextree import <token|file> [--prefix team]
contextree install --status          # wired / to wire / not detected
```

Add `--copy` to `render` or `route` to paste the block into a chat that has neither a hook nor MCP.

## The extension

```bash
npm run package:ext    # produces extension/contextree-vscode-0.1.0.vsix
code   --install-extension extension/contextree-vscode-0.1.0.vsix
cursor --install-extension extension/contextree-vscode-0.1.0.vsix
```

It shows the tree in the sidebar, highlights the branches actually read on the last turn, and opens a 2D canvas where you edit a branch and try a prompt without starting a conversation.

## Sharing a tree with your team (git)

A team that already has a shared repository needs nothing else: version
`.contextree/` with the project, or mount it as a submodule if several
repositories share the same context.

```bash
git submodule add <tree-url> .contextree   # either this, or simply the folder in the repo
```

Pull, push, conflicts, history and review are git's. `.contextree.local/`
— your personal layer — is **gitignored as soon as the tree is created**: what
you override there never goes to the group.

Two things to know before the first merge: an unresolved conflict in a branch's
body **goes to the model** as is, and a conflict in the frontmatter **does not
show** — the displayed `load_when` is then one of the two, at random.
After a merge that touches `.contextree/`, reread the `load_when` involved.

The details: `contextree list`, then the "Partager un arbre par git" branch.

## This project's documentation is its tree

There is no `.md` at the root other than this README, in its two languages: everything lives in `.contextree/`, one branch per topic, loaded when it helps. The tree of this repository is written in French.

```bash
contextree list                        # the topics and their conditions
contextree route "<a question>"        # what an AI would receive
contextree render                      # everything, at once
```

It is also the only honest test of the tool: if an answer is not in there, it is a `load_when` to fix, not a file to recreate.

## Origin

Extracted from [Lacis](../ai-tree) (the `ai-tree` repo), whose context tree was the real value but stayed buried under a full VS Code extension. Here, only the core is kept.
