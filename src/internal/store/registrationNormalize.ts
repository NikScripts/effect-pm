/**
 * Normalize {@link Store.Service} registration inputs (tuple, array, object record).
 *
 * @module internal/store/registrationNormalize
 * @internal
 */

import {
  isStoreRegistration,
  type StoreRegistrationAny,
} from "./registration";
import {
  isStoreContractValue,
  isStoreShapeMap,
  toStoreContract,
  type StoreContractValue,
} from "./contractDef";
import { isStoreSpec, type StoreSpec } from "./spec";
import { StoreDuplicateScopeKey } from "./errors";

export const storeStandaloneSym = Symbol.for("@nikscripts/effect-pm/Store/standalone");
export const storeSingleSym = Symbol.for("@nikscripts/effect-pm/Store/single");

/** @internal */
export interface NormalizedStoreRegistration<
  K extends string = string,
  A extends string = string,
  S extends StoreSpec = StoreSpec,
> {
  readonly scopeKey: K;
  readonly accessor: A;
  readonly spec: S;
  readonly contract?: StoreContractValue;
  readonly tag?: StoreRegistrationAny["tag"];
  readonly logLevel?: StoreRegistrationAny["logLevel"];
  readonly maxRows?: number;
}

/** @internal */
export interface StandaloneStoreShape {
  readonly [storeStandaloneSym]: true;
  readonly scopeKey: string;
  readonly spec: StoreSpec;
  readonly contract?: StoreContractValue;
  readonly tag?: StoreRegistrationAny["tag"];
}

/** @internal */
export const isStandaloneStoreClass = (value: unknown): value is StandaloneStoreShape =>
  typeof value === "function" && storeStandaloneSym in value;

/** @internal */
const isNamedRecord = (
  value: unknown,
): value is Record<
  string,
  StoreRegistrationAny | StoreSpec | StoreContractValue | StandaloneStoreShape | StoreContractValue["shapes"]
> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !isStoreRegistration(value) &&
  !isStandaloneStoreClass(value) &&
  Object.values(value).every(
    (entry) =>
      isStoreRegistration(entry) ||
      isStandaloneStoreClass(entry) ||
      isStoreSpec(entry) ||
      isStoreContractValue(entry) ||
      isStoreShapeMap(entry),
  );

/** @internal */
const pushRegistration = (
  registrations: Array<NormalizedStoreRegistration>,
  scopeKeys: Set<string>,
  entry: NormalizedStoreRegistration,
): void => {
  if (scopeKeys.has(entry.scopeKey)) {
    throw new StoreDuplicateScopeKey({ key: entry.scopeKey });
  }
  scopeKeys.add(entry.scopeKey);
  registrations.push(entry);
};

/** @internal */
const fromRegistration = (
  registration: StoreRegistrationAny,
  accessor?: string,
): NormalizedStoreRegistration => ({
  scopeKey: registration.scopeKey,
  accessor: accessor ?? registration.scopeKey,
  spec: registration.spec,
  contract: registration.contract,
  tag: registration.tag,
  logLevel: registration.logLevel,
  maxRows: registration.maxRows,
});

/** @internal */
const fromStandaloneClass = (
  storeClass: StandaloneStoreShape,
  accessor?: string,
): NormalizedStoreRegistration => ({
  scopeKey: storeClass.scopeKey,
  accessor: accessor ?? storeClass.scopeKey,
  spec: storeClass.spec,
  contract: storeClass.contract,
  tag: storeClass.tag,
});

const fromContractInput = (
  scopeKey: string,
  input: StoreContractValue | StoreContractValue["shapes"],
): NormalizedStoreRegistration => {
  const contract = toStoreContract(input);
  return {
    scopeKey,
    accessor: scopeKey,
    spec: contract.spec,
    contract,
  };
};

const fromFlatSpec = (scopeKey: string, spec: StoreSpec): NormalizedStoreRegistration => ({
  scopeKey,
  accessor: scopeKey,
  spec,
});

/** @internal */
export const normalizeStoreRegistrations = (
  input: unknown,
): {
  readonly registrations: ReadonlyArray<NormalizedStoreRegistration>;
  readonly named: boolean;
} => {
  const registrations: Array<NormalizedStoreRegistration> = [];
  const scopeKeys = new Set<string>();

  if (Array.isArray(input)) {
    for (const value of input) {
      if (isStoreRegistration(value)) {
        pushRegistration(registrations, scopeKeys, fromRegistration(value));
        continue;
      }
      if (isStandaloneStoreClass(value)) {
        pushRegistration(registrations, scopeKeys, fromStandaloneClass(value));
      }
    }
    return { registrations, named: false };
  }

  if (isStoreRegistration(input)) {
    pushRegistration(registrations, scopeKeys, fromRegistration(input));
    return { registrations, named: false };
  }

  if (isStandaloneStoreClass(input)) {
    pushRegistration(registrations, scopeKeys, fromStandaloneClass(input));
    return { registrations, named: false };
  }

  if (isNamedRecord(input)) {
    for (const [accessor, value] of Object.entries(input)) {
      if (isStoreRegistration(value)) {
        pushRegistration(registrations, scopeKeys, fromRegistration(value, accessor));
        continue;
      }
      if (isStandaloneStoreClass(value)) {
        pushRegistration(registrations, scopeKeys, fromStandaloneClass(value, accessor));
        continue;
      }
      if (isStoreSpec(value)) {
        pushRegistration(registrations, scopeKeys, fromFlatSpec(accessor, value));
        continue;
      }
      if (isStoreContractValue(value) || isStoreShapeMap(value)) {
        pushRegistration(registrations, scopeKeys, fromContractInput(accessor, value));
      }
    }
    return { registrations, named: true };
  }

  return { registrations, named: false };
};

/** True when {@link Store.Service} input is a bare single registration (not `[]` or `{}`). @internal */
export const isSingleStoreServiceInput = (input: unknown): boolean => {
  if (Array.isArray(input)) {
    return false;
  }
  if (isNamedRecord(input)) {
    return false;
  }
  return isStoreRegistration(input) || isStandaloneStoreClass(input);
};
