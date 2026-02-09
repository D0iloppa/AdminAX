# Integration Test Implementation Plan

## Goal
Update `test_converter.sh` to test the full data pipeline:
`Mock Java Producer` -> `Redis` -> `Converter Worker` -> `Redis` -> `Mock Java Consumer`

## Changes

### 1. Update Mock Scripts
- Modify `test_stage1_mock_java.py` and `test_stage3_mock_java_consumer.py`.
- Use `os.getenv('REDIS_HOST', 'localhost')` to support running inside Docker container (where host is `adminax-redis`).

### 2. Update `test_converter.sh`
- **Step 1: Cleanup**: Remove old test data.
- **Step 2: Prepare**: Create a dummy HWP file in `/app/shared-docs/raw/`.
- **Step 3: Consumer (Background)**: Run `test_stage3_mock_java_consumer.py` in a Docker container connected to `adminax-network`. It waits for the result.
- **Step 4: Producer**: Run `test_stage1_mock_java.py` in a Docker container connected to `adminax-network`. It sends the job.
- **Step 5: Verify**: The Consumer script should print the result and exit.

## Verification
- Run `sudo ./test_converter.sh` on the host.
- It should output:
  - Docker build success.
  - "Waiting for results..." (Consumer)
  - "Job Sent..." (Producer)
  - "Message Received!" (Consumer) with valid JSON content.
