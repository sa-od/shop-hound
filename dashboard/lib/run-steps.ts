import type { RunStep } from './api';

/** The steps of one analysis, in order, as the user sees them. */
export const RUN_STEPS: RunStep[] = ['reading', 'comparing', 'grounding', 'writing', 'safety'];

export function stepLabel(step: RunStep, baseline?: boolean): string {
  switch (step) {
    case 'reading':
      return 'Reading the catalog';
    case 'comparing':
      return baseline ? 'Saving the baseline' : 'Comparing with the last check';
    case 'grounding':
      return 'Fact-checking the numbers';
    case 'writing':
      return 'Writing the brief';
    case 'safety':
      return 'Safety check';
  }
}

/** 1-based position of a step ("Writing the brief (4 of 5)"). */
export const stepNumber = (step: RunStep) => RUN_STEPS.indexOf(step) + 1;
