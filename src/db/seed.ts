import { db, schema } from "./index";

if (db.select().from(schema.employees).all().length === 0) {
  db.insert(schema.employees)
    .values(["Anna", "Bartek", "Celina", "Dorota"].map((name) => ({ name })))
    .run();
  console.log("Dodano przykładowych pracowników");
}
