# Reference notes

## LumiTracker

- Repository: https://github.com/LumiOwO/LumiTracker
- Local read-only snapshot: `../references/LumiTracker`
- Reference commit: `1120dda`
- README feature set: own/opponent played cards, draw, cards inserted into deck, deck import and
  round tracking are marked complete; discard, elemental tuning, deck top and damage calculation
  are marked incomplete in this snapshot.
- Architecture: Windows capture, image hash/Annoy recognition, Python watcher state machine, C# WPF
  UI and native launcher. We borrow the product vocabulary and event categories, not the implementation.

## Rain simulator page inspection

- The public home page exposes ordinary controls, but the game board is rendered by SolidJS into a
  dynamic 3D DOM. Stable source-level markers include `.gi-tcg-chessboard-new`, `.card`,
  `[data-opp-hand]`, `[data-hidden]`, character areas, and card-count hints.
- Card elements do not expose a stable entity id in the rendered DOM; image loading can also replace
  the face with a data URL. Therefore DOM-only capture is suitable for visible names/counts and
  readiness, not for inventing exact card transitions.
- The production HTML adapter must either consume a separately exposed notification/event channel or
  report unknown exits. It must not infer the opponent's hand from DOM order or from the ellipsis
  status groups.
- The page source exposes the preferred event route as an authenticated SSE endpoint under
  `/api/rooms/:roomId/players/:playerId/notification`; the local bridge mirrors its `Notification`
  payload without action control.

## Upstream

- Rules/data source: `../genius-invokation`
- The tracker reads only its own `TrackerFrame` contract at runtime. The upstream simulator generator
  is an independent adapter in this project.
