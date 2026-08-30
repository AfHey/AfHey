/**
 * Domain enum surface. The generated Prisma enums are the single source of
 * truth (they mirror product-spec §9/§11 exactly); the rest of the codebase
 * imports them from here rather than reaching into the generated client.
 */
export {
  ApprovalPolicy,
  BlockState,
  CaptureProcessingStatus,
  CaptureSourceType,
  Confidence,
  CredentialKind,
  DeadlineType,
  EnergyLevel,
  EntityType,
  EventKind,
  Importance,
  OperationType,
  ProjectKind,
  ProjectStatus,
  ProposalOrigin,
  ProposalStatus,
  ScheduleType,
  SyncStatus,
  TaskBucket,
  TaskKind,
  TaskStatus,
  UserPriority,
  WorkType,
} from "@/db/generated/enums";
