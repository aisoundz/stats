# Live testing, Game Night #14 and #15 — Thursday 20 August 2026

Founder's own notes from testing the app as a player, an hour before first
pitch. Recorded verbatim first, diagnosis second. Nothing here is fixed yet.

> "I began testing all the game tester."

Two of these correct things I told him earlier the same evening. Both
corrections are noted where they belong rather than quietly folded in.

---

## 1. A pick auto-advances instantly, with no chance to change it

> "When you pick a question it automatically moves you to the next question
> without letting you change or press next. It moves it fast."

**Why it matters most of the five.** The whole product is one tap on what just
happened. If the tap is irreversible and instant, a mis-tap is a lost question
and there is nothing the player can do about it. It also makes the Next button
a lie: it is on screen, and the card has already moved past it.

**Status: not located statically.** There is no `autoAdvance`, no
`setTimeout(...next)` and no `advance()` in index.html, so whatever moves the
card is doing it through a path that is not named for what it does. Needs to be
found by driving the deck, not by reading it.

**The fix, whatever the cause:** a pick should never move the card. The player
presses Next. If auto-advance is wanted later it needs an undo window, and the
Next button should disappear when it is on, because two things cannot both own
the same transition.

## 2. There is no way out once questions start

> "When the questions come up there is no way to get to the menu or go back
> home. The tabs disappear. We should have home buttons or something there to
> help us navigate."

The four tabs are the wordmark, Home · Stats · Gametime · Board, and they are
the only navigation the app has. Removing them during the one screen a player
spends the most time on leaves them with the browser back button, which in this
app is not a safe thing to press.

**Status: not located statically.** No `navHide`, no `hideNav`, no rule that
hides the tab bar by name. Same as #1: it has to be driven to be found.

## 3. Spanish still shows English inside the round flow

> "When we do in spanish some of the words are still in english."

**THIS CORRECTS WHAT I TOLD HIM TONIGHT.** I reported Spanish at 100% and
capped the gate at zero untranslated strings, and both of those are true of
**what the walker reaches**: 17 screens, 234 visible strings. He is looking at
screens the walker never opens, almost certainly the live round flow, which
needs a running night with published rounds to exist at all.

So the number was honest and the claim was not. "100% of the screens we walk"
is a different sentence from "the app is in Spanish", and I said the second one.

**The fix is to the walker before it is to the dictionary.** qa/spanish.js has
to reach a live round, a question, an answer and the between-rounds screen. A
coverage number that cannot see the busiest screen in the product is the same
class of problem as a check that cannot fail.

## 4. The pre-game card opens on question 6, then goes to 1

> "When you start with your selection of your picks for the pregame questions.
> It starts with question 6 and then goes to question 1."

**THIS ALSO CORRECTS ME.** When he first hit it I attributed it to a stale
local draft in a tab that had been open all day, and told him a hard reload
would clear it. He cleared local storage, I deleted his seat and his telemetry
row server-side, and **it happened again on a clean load**. So it is not stale
state. It is the deck.

Observed alongside it: the counter read "2 of 6" while the card summary read
"6 / 6 locked", so two parts of the same screen disagreed about the same card.

`PD.i` is clamped in five places (`index.html:8826, 8858, 8903, 8904`) but
nothing found so far sets it to the last index on entry. The opening index and
the dot strip are reading different things, and one of them is wrong.

**Scoring integrity, not cosmetics.** A card that opens on the last question and
restores answers positionally can attach a pick to a question the player never
chose it for.

## 5. The Control Room does not say which room Caught It is on

> "For the control room there is no way to tell which caught it game you have
> on in the run tab."

**Confirmed statically, and it is the smallest fix of the five.** The button
reads `⏸ Call It: ON` and the state line reads `armed — watching the feed`
(admin.html:5629-5630). Neither names a game. `CI.owner` already holds the
nightId, so the label can say it.

This matters more than it looks because Caught It can only ever be on one room,
and switching rooms silently turns it off on the one you left. A host running
two rooms has no way to see which one is armed, which is exactly the situation
tonight with baseball at 5:05 and football at 7:00.

---

## Order I would fix them

1. **#4**, because it can mis-record a card.
2. **#1**, same reason, and it is the most common interaction in the product.
3. **#2**, because being trapped on a screen is how somebody leaves and does
   not come back.
4. **#5**, small, host-only, and it prevents a hosting mistake tonight's slate
   makes easy.
5. **#3**, which is really "fix the walker", then whatever it then finds.

Nothing was changed during the night. Every fix goes on index-test.html and
through the full gate.
