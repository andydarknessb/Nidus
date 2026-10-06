// The word in a phone header's pill is drawn only while the header has room for it, and a screen reader always hears the whole sentence
// (the pill's icon stays). The header is the `group/header`; a second pill is a `[data-pill]` that follows the first.
//
// "Offline" keeps its word: it is what tells the person the Wall is behind, and the phone's header has room for it beside the date, the pill
// of stale sync and the gear from 360 px wide, the narrowest phone worth drawing for. Below 360 px, beside a second pill, it is the icon alone.
export const PHONE_OFFLINE_WORD = 'max-[360px]:group-has-[[data-pill]~[data-pill]]/header:hidden';
// Stale sync is compact, its icon and a short age ("3 h"): beside Offline there is no room for the age as well, and it is the icon alone.
export const PHONE_SYNC_WORD = 'max-[340px]:hidden group-has-[[data-pill]~[data-pill]]/header:hidden';
// The two pills' shape: 36 tall, an icon and a word 4 px apart, 8 px in from their edges, so that both fit beside the date and the gear at 360 px.
export const PHONE_PILL = 'inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-sm font-medium whitespace-nowrap';
