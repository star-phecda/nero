# Phase 5.3 — Identity & Context Isolation

Date: 2026-10-05

## Problem

Nero's pre-5.3 group conversation context is keyed by chat only. Incoming non-privileged group messages are labeled generically as "Group member", so the recent-context window can let Person B inherit Person A's conversational thread.

Phase 3 memory already has typed memories and scopes, but the WhatsApp integration only retrieves the current group/chat scope plus Master memory. There is no stable person scope.

## Design

Phase 5.3 introduces a small identity/context envelope:

- chatId — the current WhatsApp chat.
- senderId — the normalized stable sender identity.
- role — master, dawn, or person.
- displayName — current/known display name.
- personId — stable identity key.
- personScope — person:<id> for ordinary people and Dawn; Master uses master.
- conversationKey — chatId|personId.

### Context separation

1. Person memory is global across chats.
   - A person's memory lives under person:<id>.
   - The same person can appear in multiple groups and retain one coherent profile.

2. Conversational history is local to chat + person.
   - A's thread in Group 1 is not reused as A's thread in Group 2.
   - B's thread in Group 1 is never reused for A.

3. Shared/group memory remains separate.
   - group:<jid> remains shared memory for that chat.
   - master remains global Master memory.

4. Raw shared group history is not the default conversational thread.
   - It is loaded when the request explicitly asks about the wider group/chat.
   - Normal responses use the current speaker's chat-local person thread.

## Memory scopes

Prompt-time retrieval for a normal person uses:

- master
- group:<jid>
- person:<senderId>

Master uses:

- master
- group:<jid>

## Manual person-memory commands

Privileged users can create or remove person-scoped memories:

- !remember person:<phone-or-jid> <fact>
- !remember person:current <fact>
- !forget person:<phone-or-jid> <query>
- !forget person:current <query>

## Boundaries

Phase 5.3 does not automatically infer and save arbitrary personal facts from every message yet. Automatic significance detection should be a later, separately tested layer. This phase establishes the identity boundary first so that later memory extraction has a safe destination.

## Acceptance criteria

- Person A and Person B in the same group produce different conversation keys.
- The same person in two groups shares one person identity/profile but not a conversation thread.
- Person A memory is retrievable for A and excluded from B's memory scope.
- Shared group memory is retrievable for both.
- Master memory remains globally retrievable.
- Prompt construction identifies the current speaker and labels memory scope.
- Existing group history/recap remains available for explicit group-history requests.
