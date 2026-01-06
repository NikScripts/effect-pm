# Future Ideas & Enhancements

This document tracks ideas and potential enhancements for future versions of `@nikscripts/effect-pm`.

## Execution Context in Callbacks

**Status:** Future consideration  
**Difficulty:** Low-Medium  
**Priority:** Medium

### Idea
Add execution context/metadata as a 4th parameter to `onSuccess` and `onError` callbacks, providing useful information about the execution.

### Proposed Context Object
```typescript
interface ExecutionContext {
  duration: number;        // Execution time in milliseconds
  startTime: Date;         // When processing started
  endTime: Date;           // When processing completed
  waitTime: number;        // Time from add() to processing start (ms)
  priority: "high" | "normal" | "low";  // Priority level processed at
  poolSize: number;        // Pool size when item started processing
  workers: number;         // Active worker count at start
}
```

### Implementation Approach
- Add as 4th parameter to maintain backward compatibility
- Track timing in `processItem` function
- Track priority level (already known in `getNextItemBlocking`)
- Snapshot pool state at processing start
- Calculate wait time (requires tracking when items are added to queues)

### Use Cases
- Performance monitoring and alerting
- Logging execution metrics
- Adaptive retry logic based on duration
- Priority-based alerting (slow high-priority items)
- Queue wait time analysis

### Challenges
- **Wait time tracking**: Requires wrapping queue operations to timestamp items when added
  - Could store `{ item, addedAt }` in queues instead of just `item`
  - Medium complexity
- **Performance**: Minimal overhead (Date.now() calls)
- **Type complexity**: Simple with 4th parameter approach

### Notes
- Backward compatible (4th parameter, optional to use)
- Could start with just `duration` and `priority` (easiest to implement)
- Wait time tracking is the most complex part

---

## Other Ideas

*Add more future ideas here as they come up...*

