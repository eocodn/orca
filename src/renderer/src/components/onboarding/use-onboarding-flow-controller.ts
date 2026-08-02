// Public controller facade; onboarding orchestration remains behind a named concrete module.
export { STEPS, useOnboardingFlow } from './onboarding-flow-orchestration'
export type {
  OnboardingFlowController,
  StepId,
  StepNumber
} from './onboarding-flow-orchestration'
