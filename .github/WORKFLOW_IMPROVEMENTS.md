# GitHub Actions Workflow Improvements

## Overview
This document describes the improvements made to the GitHub Actions workflows to prevent rate limiting issues, checkout errors, and concurrent execution problems.

## Problems Addressed

1. **Concurrent Execution**: Multiple workflows were starting at similar times, causing GitHub API rate limits
2. **Checkout Failures**: Temporary GitHub errors (403, account suspended, RPC failed, packfile errors) during checkout
3. **No Retry Logic**: Failed checkouts would cause entire workflow failures
4. **No Concurrency Control**: Multiple runs of the same workflow could execute simultaneously

## Solutions Implemented

### 1. Distributed Cron Schedules

Workflows are now staggered to avoid simultaneous execution:

| Workflow | Old Schedule | New Schedule | Frequency |
|----------|-------------|--------------|-----------|
| **zoho-service-order** | 15:30 daily | **15:02** daily | Once per day |
| **hablla-cards** | :10 every 6h | **:07** every 6h | 4 times per day (3:07, 9:07, 15:07, 21:07) |
| **hablla-attendants** | 6:17 daily | **6:13** daily | Once per day |
| **hablla-clients** | :05 every 6h | **:18** every 6h | 4 times per day (3:18, 9:18, 15:18, 21:18) |
| **zoho-service-order-recent** | :40 every 6h | **:23** every 6h | 4 times per day (1:23, 7:23, 13:23, 19:23) |

**Result**: Workflows start at :02, :07, :13, :18, and :23, providing good distribution across the hour.

### 2. Random Delays Before Checkout

Each workflow now includes a random delay (10-40 seconds) before checkout:

```yaml
- name: Random delay to avoid rate limiting
  run: sleep $((RANDOM % 30 + 10))
```

**Benefits**:
- Spreads API calls even if workflows start at the same scheduled time
- Reduces likelihood of hitting GitHub rate limits
- Provides natural jitter in execution patterns

### 3. Checkout Retry Logic

Implemented automatic retry mechanism for checkout failures:

```yaml
- name: Checkout with retry
  uses: actions/checkout@v4
  with:
    fetch-depth: 1
  continue-on-error: true
  id: checkout1

- name: Retry checkout if failed
  if: steps.checkout1.outcome == 'failure'
  run: |
    sleep $((RANDOM % 20 + 10))
    
- name: Checkout retry attempt
  if: steps.checkout1.outcome == 'failure'
  uses: actions/checkout@v4
  with:
    fetch-depth: 1
```

**Benefits**:
- Automatically retries checkout on failure
- Adds random delay before retry to avoid repeating the same error
- Handles temporary GitHub API issues gracefully

### 4. Shallow Clones

Added `fetch-depth: 1` to all checkout steps:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 1
```

**Benefits**:
- Faster checkout times
- Reduced bandwidth usage
- Lower chance of packfile errors

### 5. Concurrency Control

Added concurrency groups to prevent overlapping runs:

```yaml
concurrency:
  group: workflow-name
  cancel-in-progress: false
```

**Benefits**:
- Prevents multiple instances of the same workflow from running simultaneously
- Queues new runs if a run is already in progress
- Avoids resource conflicts and race conditions

## Best Practices Implemented

1. ✅ **Distributed Scheduling**: Each workflow starts at a different minute
2. ✅ **Random Jitter**: Random delays spread API calls naturally
3. ✅ **Automatic Retries**: Transient failures are handled automatically
4. ✅ **Shallow Clones**: Faster and more reliable checkouts
5. ✅ **Concurrency Control**: Prevents overlapping workflow runs
6. ✅ **Same Cadence**: Maintained original execution frequency
7. ✅ **No Logic Changes**: Only infrastructure improvements, no business logic changes

## Expected Improvements

- **Reduced Rate Limit Errors**: Distributed schedules and random delays prevent simultaneous API calls
- **Higher Success Rate**: Retry logic handles temporary GitHub issues automatically
- **Faster Execution**: Shallow clones reduce checkout time and failure points
- **Better Resource Management**: Concurrency control prevents conflicts

## Monitoring Recommendations

1. Monitor workflow run history for checkout failures
2. Check if retry logic is frequently triggered (may indicate persistent issues)
3. Review timing of workflow starts to verify distribution
4. Adjust random delay ranges if needed based on observed patterns

## Future Considerations

If rate limiting issues persist, consider:
- Increasing random delay ranges (e.g., 30-90 seconds)
- Further spreading cron schedules (e.g., :02, :12, :22, :32, :42)
- Implementing exponential backoff for retries
- Adding GitHub token authentication for higher rate limits
- Using GitHub Actions cache to reduce checkout frequency
