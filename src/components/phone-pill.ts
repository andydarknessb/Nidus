// The word in a phone header's pill (Offline, "3 h") is drawn only while the header has room for it: not beside a second pill and not
// on a very narrow screen. The pill's icon stays, and a screen reader always hears the whole sentence. The header is the `group/header`.
export const PHONE_PILL_WORD = 'max-[340px]:hidden group-has-[[data-pill]~[data-pill]]/header:hidden';
