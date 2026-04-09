import { describe, expect, it } from "@effect/vitest"
import {
  HttpApiResource,
  QueueResource,
  Resource,
  RunResource,
} from "../src"

describe("Resource umbrella", () => {
  it("delegates to focused modules by reference", () => {
    expect(Resource.make).toBe(RunResource.make)
    expect(Resource.makeRunner).toBe(RunResource.makeRunner)
    expect(Resource.makeHttpApiClient).toBe(HttpApiResource.make)
    expect(Resource.makeQueue).toBe(QueueResource.make)
    expect(Resource.acceptJson).toBe(HttpApiResource.acceptJson)
  })
})
