// Public onboarding facade; flow state and side effects live in the concrete implementation.
export { STEPS, useOnboardingFlow } from './onboarding-flow-implementation'
export type {
  OnboardingFlowController,
  StepId,
  StepNumber
} from './onboarding-flow-implementation'
