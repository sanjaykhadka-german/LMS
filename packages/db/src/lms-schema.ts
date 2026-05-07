// Drizzle mappings for the legacy Flask LMS tables in the default `public`
// schema. Flask owns these tables (SQLAlchemy models in /models.py); we
// declare them here only so Tracey can read/write them. Drizzle-kit's
// drizzle.config.ts intentionally does NOT include this file in its `schema`
// field, so `pnpm db:generate` will never try to migrate these tables.
//
// No Drizzle-level unique indexes are declared here — those constraints live
// on the Flask side (models.py) and re-declaring them would be dead weight.

import {
  boolean,
  customType,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// postgres.js returns BYTEA as Buffer; emit it the same way on insert.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const lmsUsers = pgTable("users", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name").default(""),
  lastName: text("last_name").default(""),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("employee"),
  isActiveFlag: boolean("is_active_flag").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  phone: text("phone").default(""),
  departmentId: integer("department_id"),
  employerId: integer("employer_id"),
  startDate: date("start_date"),
  terminationDate: date("termination_date"),
  photoFilename: text("photo_filename"),
  jobTitle: text("job_title").default(""),
  managerId: integer("manager_id"),
  positionId: integer("position_id"),
  traceyUserId: text("tracey_user_id"),
  traceyTenantId: text("tracey_tenant_id"),
});

export const lmsModules = pgTable("modules", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  title: text("title").notNull(),
  description: text("description").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  isPublished: boolean("is_published").default(true),
  createdById: integer("created_by_id"),
  coverPath: text("cover_path").default(""),
  validForDays: integer("valid_for_days"),
});

export const lmsContentItems = pgTable("content_items", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").default(""),
  filePath: text("file_path").default(""),
  position: integer("position").default(0),
});

export const lmsContentItemMedia = pgTable("content_item_media", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  contentItemId: integer("content_item_id").notNull(),
  filePath: text("file_path").notNull(),
  kind: text("kind").default(""),
  position: integer("position").default(0),
});

export const lmsModuleMedia = pgTable("module_media", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  filePath: text("file_path").notNull(),
  kind: text("kind").default(""),
  position: integer("position").default(0),
});

export const lmsQuestions = pgTable("questions", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  prompt: text("prompt").notNull(),
  kind: text("kind").default("single"),
  position: integer("position").default(0),
});

export const lmsChoices = pgTable("choices", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  questionId: integer("question_id").notNull(),
  text: text("text").notNull(),
  isCorrect: boolean("is_correct").default(false),
  position: integer("position").default(0),
});

export const lmsAssignments = pgTable("assignments", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  userId: integer("user_id").notNull(),
  moduleId: integer("module_id").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  versionId: integer("version_id"),
});

export const lmsModuleVersions = pgTable("module_versions", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  // Flask stores this as TEXT (db.Text), parse with JSON.parse in TS.
  snapshotJson: text("snapshot_json").notNull(),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
  summary: text("summary").default(""),
});

export const lmsAttempts = pgTable("attempts", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  userId: integer("user_id").notNull(),
  moduleId: integer("module_id").notNull(),
  score: integer("score").default(0),
  correct: integer("correct").default(0),
  total: integer("total").default(0),
  passed: boolean("passed").default(false),
  answersJson: text("answers_json").default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lmsDepartments = pgTable("departments", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
});

export const lmsEmployers = pgTable("employers", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
});

export const lmsMachines = pgTable("machines", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  departmentId: integer("department_id"),
});

export const lmsPositions = pgTable("positions", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  departmentId: integer("department_id"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lmsUserMachines = pgTable(
  "user_machines",
  {
    userId: integer("user_id").notNull(),
    machineId: integer("machine_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.machineId] })],
);

export const lmsMachineModules = pgTable(
  "machine_modules",
  {
    machineId: integer("machine_id").notNull(),
    moduleId: integer("module_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.moduleId] })],
);

export const lmsDepartmentModulePolicies = pgTable("department_module_policies", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  departmentId: integer("department_id").notNull(),
  moduleId: integer("module_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lmsUploadedFiles = pgTable("uploaded_files", {
  filename: text("filename").primaryKey(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  data: bytea("data").notNull(),
  size: integer("size").default(0),
  uploadedById: integer("uploaded_by_id"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export type LmsUser = typeof lmsUsers.$inferSelect;
export type NewLmsUser = typeof lmsUsers.$inferInsert;
export type LmsDepartment = typeof lmsDepartments.$inferSelect;
export type LmsEmployer = typeof lmsEmployers.$inferSelect;
export type LmsMachine = typeof lmsMachines.$inferSelect;
export type LmsPosition = typeof lmsPositions.$inferSelect;
export type LmsModule = typeof lmsModules.$inferSelect;
export type LmsContentItem = typeof lmsContentItems.$inferSelect;
export type LmsContentItemMedia = typeof lmsContentItemMedia.$inferSelect;
export type LmsModuleMedia = typeof lmsModuleMedia.$inferSelect;
export type LmsQuestion = typeof lmsQuestions.$inferSelect;
export type LmsChoice = typeof lmsChoices.$inferSelect;
export type LmsAssignment = typeof lmsAssignments.$inferSelect;
export type NewLmsAssignment = typeof lmsAssignments.$inferInsert;
export type LmsModuleVersion = typeof lmsModuleVersions.$inferSelect;
export type LmsAttempt = typeof lmsAttempts.$inferSelect;
export type NewLmsAttempt = typeof lmsAttempts.$inferInsert;
