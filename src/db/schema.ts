import { sqliteTable, text, integer, real, unique } from "drizzle-orm/sqlite-core";

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  fte: real("fte").notNull().default(1), // full-time equivalent
  employedFrom: text("employed_from"), // null = no limit
  employedTo: text("employed_to"),
});

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  year: integer("year").notNull(),
  quarter: integer("quarter").notNull(),
  hoursOverride: integer("hours_override"), // null = 496
  staff: integer("staff").notNull().default(2), // exact staffing (people per shift) for all days
  staffOverrides: text("staff_overrides").notNull().default("{}"), // JSON { "YYYY-MM-DD": number } for selected days
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
});

// One schedule cell: an employee's shift code on a given day. locked = user entry or accepted cell.
export const assignments = sqliteTable(
  "assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scheduleId: integer("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    code: text("code").notNull(),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [unique().on(t.scheduleId, t.employeeId, t.date)]
);
