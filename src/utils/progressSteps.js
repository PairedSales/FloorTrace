// What the app says it is doing while it measures a plan by itself, and the
// three steps those messages belong to.
//
// The messages are constants because two things read them: `App.jsx` sets them
// as the running job's message, and the results panel matches the running
// message against this list to show which of the three steps is under way. As
// string literals in both places they were one rewording away from the panel
// showing a bare spinner for a step it could no longer recognise.
//
// The steps are the job in the user's words — read the sizes, work out the
// scale, find the walls — said while it happens and gone when it is done. They
// are not a pipeline to operate: nothing here is a button.
export const PROGRESS = {
  readingSizes: 'Reading the room sizes…',
  measuringRooms: 'Measuring the rooms…',
  findingOutline: 'Finding the outline…',
};

export const MEASURE_STEPS = [
  { id: 'read', label: 'Reading the room sizes', message: PROGRESS.readingSizes },
  { id: 'scale', label: 'Working out the scale', message: PROGRESS.measuringRooms },
  { id: 'outline', label: 'Finding the outside walls', message: PROGRESS.findingOutline },
];

/** Which step a running job's message belongs to, or -1 when it is none of them. */
export const measureStepIndex = (message) =>
  MEASURE_STEPS.findIndex((step) => step.message === message);
