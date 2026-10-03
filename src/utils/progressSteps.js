// What the app says it is doing while it measures a plan by itself, and the
// steps those messages belong to.
//
// The messages are constants because two things read them: `App.jsx` sets them
// as the running job's message, and the results panel matches the running
// message against this list to show which of the steps is under way. As
// string literals in both places they were one rewording away from the panel
// showing a bare spinner for a step it could no longer recognise.
//
// The steps are the job in the user's words — read the sizes, work out the
// scale, find the walls, add up the area. They are said while it happens and
// they stay on the panel when it is done, each as the conclusion it reached.
export const PROGRESS = {
  readingSizes: 'Reading the room sizes…',
  measuringRooms: 'Measuring the rooms…',
  findingOutline: 'Finding the outline…',
};

// Each step in its three tenses: while it runs, once it has produced
// something, and when there is nothing to show for it. One declaration, because
// the start screen, the measuring panel and the finished panel all say them and
// a step that changed its name between two of those would read as a different
// step.
export const STEP_TITLES = {
  read: { doing: 'Reading the room sizes', done: 'Read the room sizes', missing: 'No room sizes read' },
  scale: { doing: 'Working out the scale', done: 'Worked out the scale', missing: 'The scale is not set' },
  outline: { doing: 'Finding the outside walls', done: 'Found the outside walls', missing: 'No outline yet' },
  area: { doing: 'Adding up the area', done: 'Added up the area', missing: 'No area yet' },
};

// The three a running job reports on. Adding up the area is not a job: it is
// done the moment there is an outline and a scale.
export const MEASURE_STEPS = [
  { id: 'read', label: STEP_TITLES.read.doing, message: PROGRESS.readingSizes },
  { id: 'scale', label: STEP_TITLES.scale.doing, message: PROGRESS.measuringRooms },
  { id: 'outline', label: STEP_TITLES.outline.doing, message: PROGRESS.findingOutline },
];

/** Which step a running job's message belongs to, or -1 when it is none of them. */
export const measureStepIndex = (message) =>
  MEASURE_STEPS.findIndex((step) => step.message === message);
