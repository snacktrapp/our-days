export const resumeRefreshDebounceMs = 1_200;

export function shouldResumeRefreshOnVisibility(input: {
  wasHidden: boolean | null;
  isHidden: boolean;
}) {
  return input.wasHidden === true && input.isHidden === false;
}

export function shouldResumeRefreshOnPageShow(input: { persisted: boolean }) {
  return input.persisted === true;
}
