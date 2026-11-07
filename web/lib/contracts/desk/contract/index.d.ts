import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Status { pending = 0, acknowledged = 1, fixed = 2, retracted = 3 }

export type Finding = { digest: Uint8Array; project: Uint8Array };

export type Opening = { finding: Finding; nonce: Uint8Array };

export type Report = { tag: Uint8Array;
                       sealedAt: bigint;
                       status: Status;
                       updatedAt: bigint
                     };

export type Grade = { codeHash: Uint8Array;
                      project: Uint8Array;
                      grade: bigint;
                      rules: bigint;
                      scan: bigint;
                      selfReported: boolean
                    };

export type Witnesses<PS> = {
  researcherSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  maintainerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  attesterSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  draft(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Opening];
  openingOf(context: __compactRuntime.WitnessContext<Ledger, PS>,
            id_0: Uint8Array): [PS, Opening];
  maintainerPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
                 leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                             path: { sibling: { field: bigint },
                                                     goes_left: boolean
                                                   }[]
                                           }];
}

export type ImpureCircuits<PS> = {
  seal(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  acknowledge(context: __compactRuntime.CircuitContext<PS>,
              id_0: Uint8Array,
              now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  markFixed(context: __compactRuntime.CircuitContext<PS>,
            id_0: Uint8Array,
            now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  retract(context: __compactRuntime.CircuitContext<PS>,
          id_0: Uint8Array,
          now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  reveal(context: __compactRuntime.CircuitContext<PS>,
         id_0: Uint8Array,
         opening_0: Opening): __compactRuntime.CircuitResults<PS, []>;
  registerMaintainer(context: __compactRuntime.CircuitContext<PS>,
                     pk_0: Uint8Array,
                     project_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  attest(context: __compactRuntime.CircuitContext<PS>,
         codeHash_0: Uint8Array,
         grade_0: bigint,
         rules_0: bigint,
         scan_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  handOver(context: __compactRuntime.CircuitContext<PS>,
           newAttesterHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  acceptHandOver(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  selfGrade(context: __compactRuntime.CircuitContext<PS>,
            codeHash_0: Uint8Array,
            project_0: Uint8Array,
            grade_0: bigint,
            rules_0: bigint,
            scan_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  seal(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  acknowledge(context: __compactRuntime.CircuitContext<PS>,
              id_0: Uint8Array,
              now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  markFixed(context: __compactRuntime.CircuitContext<PS>,
            id_0: Uint8Array,
            now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  retract(context: __compactRuntime.CircuitContext<PS>,
          id_0: Uint8Array,
          now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  reveal(context: __compactRuntime.CircuitContext<PS>,
         id_0: Uint8Array,
         opening_0: Opening): __compactRuntime.CircuitResults<PS, []>;
  registerMaintainer(context: __compactRuntime.CircuitContext<PS>,
                     pk_0: Uint8Array,
                     project_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  attest(context: __compactRuntime.CircuitContext<PS>,
         codeHash_0: Uint8Array,
         grade_0: bigint,
         rules_0: bigint,
         scan_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  handOver(context: __compactRuntime.CircuitContext<PS>,
           newAttesterHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  acceptHandOver(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  selfGrade(context: __compactRuntime.CircuitContext<PS>,
            codeHash_0: Uint8Array,
            project_0: Uint8Array,
            grade_0: bigint,
            rules_0: bigint,
            scan_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  sealOf(o_0: Opening): Uint8Array;
  researcherTag(sk_0: Uint8Array, id_0: Uint8Array): Uint8Array;
  maintainerKey(sk_0: Uint8Array): Uint8Array;
  maintainerLeaf(pk_0: Uint8Array, project_0: Uint8Array): Uint8Array;
  attesterKey(sk_0: Uint8Array): Uint8Array;
  selfGradeKey(codeHash_0: Uint8Array, project_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  sealOf(context: __compactRuntime.CircuitContext<PS>, o_0: Opening): __compactRuntime.CircuitResults<PS, Uint8Array>;
  researcherTag(context: __compactRuntime.CircuitContext<PS>,
                sk_0: Uint8Array,
                id_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  maintainerKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  maintainerLeaf(context: __compactRuntime.CircuitContext<PS>,
                 pk_0: Uint8Array,
                 project_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  attesterKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  selfGradeKey(context: __compactRuntime.CircuitContext<PS>,
               codeHash_0: Uint8Array,
               project_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  seal(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  acknowledge(context: __compactRuntime.CircuitContext<PS>,
              id_0: Uint8Array,
              now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  markFixed(context: __compactRuntime.CircuitContext<PS>,
            id_0: Uint8Array,
            now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  retract(context: __compactRuntime.CircuitContext<PS>,
          id_0: Uint8Array,
          now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  reveal(context: __compactRuntime.CircuitContext<PS>,
         id_0: Uint8Array,
         opening_0: Opening): __compactRuntime.CircuitResults<PS, []>;
  registerMaintainer(context: __compactRuntime.CircuitContext<PS>,
                     pk_0: Uint8Array,
                     project_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  attest(context: __compactRuntime.CircuitContext<PS>,
         codeHash_0: Uint8Array,
         grade_0: bigint,
         rules_0: bigint,
         scan_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  handOver(context: __compactRuntime.CircuitContext<PS>,
           newAttesterHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  acceptHandOver(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  selfGrade(context: __compactRuntime.CircuitContext<PS>,
            codeHash_0: Uint8Array,
            project_0: Uint8Array,
            grade_0: bigint,
            rules_0: bigint,
            scan_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly attester: Uint8Array;
  readonly nextAttester: Uint8Array;
  readonly embargo: bigint;
  maintainers: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  registered: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  reports: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Report;
    [Symbol.iterator](): Iterator<[Uint8Array, Report]>
  };
  openings: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Opening;
    [Symbol.iterator](): Iterator<[Uint8Array, Opening]>
  };
  readonly sealedCount: bigint;
  grades: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Grade;
    [Symbol.iterator](): Iterator<[Uint8Array, Grade]>
  };
  selfGrades: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Grade;
    [Symbol.iterator](): Iterator<[Uint8Array, Grade]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               attesterHash_0: Uint8Array,
               embargoSeconds_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
