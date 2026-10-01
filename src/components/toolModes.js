import { Scaling, MousePointerClick } from 'lucide-react';

// The two modes the app has, what each is called while it is on, and what it
// asks the user to do. Data rather than markup, in its own module so the
// components that read it stay pure component exports
// (react-refresh/only-export-components). Two read it: the desktop
// `ActionBar`, which turns into the instruction while a mode is on, and the
// mobile `MobileToolContext`. `select` is deliberately absent from the table,
// and both of them treat that absence as "no mode is on".
//
// Both are about the scale, and both are started from the panel's Scale
// section. Neither has anything to commit — a length lands when it is typed, a
// room when it is clicked — so each is left with one button, Done.
//
// `touchHint` is the same instruction in the gestures a phone actually has.
export const TOOL_MODES = {
  scale: {
    icon: Scaling,
    name: 'Setting the scale',
    hint: 'Click both ends of something whose length you know, then type its length under Scale in the panel.',
    touchHint: 'Tap both ends of a length you know, then type it in the Measurement panel.',
  },
  // Not a tool flag: this one is on whenever the read labels are on screen as
  // pills, which is the state the automatic scale leaves behind only when it
  // could not choose, or that "Use a different room" returns to deliberately.
  pick: {
    icon: MousePointerClick,
    name: 'Choosing a room',
    hint: 'Click a room size on the plan to set the scale from that room.',
    touchHint: 'Tap a room size on the plan to set the scale from that room.',
  },
};
