#!/bin/bash
set -eu

# -------------------- Config --------------------
UNIT_TESTS=(
    system-initialize-test
    admin-change-test
    config-update-test
    deny-list-test
    conversion-price-test
    system-state-test
    buy-sol-test
    dequeue-fills-test
)

E2E_TESTS=(
    admin-flow
    user-flow
)

TEST_TYPE="unit"
QUIET_MODE=0
BASE_RPC_PORT=8899
DEBUG_MODE=0

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# -------------------- CLI Args --------------------
while [[ $# -gt 0 ]]; do
    case $1 in
        --test-type)
            TEST_TYPE="$2"
            shift 2
            ;;
        --quiet)
            QUIET_MODE=1
            shift
            ;;
        --debug)
            DEBUG_MODE=1
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# -------------------- Globals --------------------
FAILED_TESTS=()
COMPLETED_COUNT=0
FAILED_COUNT=0

# Determine active test list based on --test-type
if [ "$TEST_TYPE" == "e2e" ]; then
    ACTIVE_TESTS=("${E2E_TESTS[@]}")
elif [ "$TEST_TYPE" == "unit" ]; then
    ACTIVE_TESTS=("${UNIT_TESTS[@]}")
else
    echo "Invalid test type: $TEST_TYPE"
    exit 1
fi

TOTAL_TESTS=${#ACTIVE_TESTS[@]}

# -------------------- Logging --------------------
log_info() { [[ $QUIET_MODE -eq 0 ]] && echo -e "ℹ️  \033[38;5;250m[INFO]\033[0m $1"; }
log_success() { [[ $QUIET_MODE -eq 0 ]] && echo -e "✔️  \033[38;5;108m[SUCCESS]\033[0m $1"; }
log_warning() { [[ $QUIET_MODE -eq 0 ]] && echo -e "⚠️  \033[38;5;179m[WARNING]\033[0m $1"; }
log_error() { echo -e "✖️  \033[38;5;203m[ERROR]\033[0m $1"; }
log_section() {
    [[ $QUIET_MODE -eq 0 ]] && {
        echo ""
        echo -e "\n\033[38;5;244m──────────────────────────────────────────────\033[0m"
        echo -e "🔹 \033[38;5;245m$1\033[0m"
        echo -e "\033[38;5;244m──────────────────────────────────────────────\033[0m\n"
    }
}

print_header() {
    echo -e "\n\033[38;5;245m╔════════════════════════════════════════════════════════════════╗\033[0m"
    echo -e "              \033[38;5;250m⬤  ⬤  DOUBLE ZERO TEST RUNNER  ⬤  ⬤\033[0m"
    echo -e "\033[38;5;245m╚════════════════════════════════════════════════════════════════╝\033[0m\n"
}

print_footer() {
    local PASSED_COUNT=$((TOTAL_TESTS - FAILED_COUNT))

    echo -e "\n\033[38;5;245m╔════════════════════════════════════════════════════════════════╗\033[0m"
    echo -e "              \033[38;5;250m⬤  ⬤  END OF TEST RUN  ⬤  ⬤\033[0m"
    echo -e "\033[38;5;245m╠════════════════════════════════════════════════════════════════╣\033[0m"
    printf "    \033[38;5;108m✔️  Passed:\033[0m %2d    \033[38;5;203m✖️  Failed:\033[0m %2d    \033[38;5;250m🧪 Total:\033[0m %2d\n" $PASSED_COUNT $FAILED_COUNT $TOTAL_TESTS
    echo -e "\033[38;5;245m╚════════════════════════════════════════════════════════════════╝\033[0m\n"
}

print_status_bar() {
    echo -ne "\r\033[K[Completed: $COMPLETED_COUNT/$TOTAL_TESTS] [Failures: $FAILED_COUNT]"
}

# -------------------- Validator Management --------------------
VALIDATOR_PID=""
LEDGER_DIR=""
VALIDATOR_LOG="$SCRIPT_DIR/validator.log"
LOCAL_ORACLE_PID=""
LOCAL_ORACLE_KEYPAIR=""
LOCAL_ORACLE_PORT=""
LOCAL_ORACLE_LOG="$SCRIPT_DIR/e2e-oracle.log"

start_validator_with_mock_transfer_program() {
    local RPC_PORT=$1
    shift
    local RPC_URL="http://127.0.0.1:$RPC_PORT"
    local EXTRA_ARGS="$@"

    stop_validator  # ensure no leftovers

    LEDGER_DIR="./.ledger-$RPC_PORT-$(date +%s)"
    mkdir -p "$LEDGER_DIR"

    log_info "Starting validator on $RPC_URL with ledger $LEDGER_DIR"
    log_info "Mock Transfer program also deployed"

    solana-test-validator \
        --reset \
        --bpf-program dzrevZC94tBLwuHw1dyynZxaXTWyp7yocsinyEVPtt4 \
         ./mock-double-zero-program/target/deploy/mock_transfer_program.so \
        --quiet \
        --rpc-port "$RPC_PORT" \
        --ledger "$LEDGER_DIR" \
        $EXTRA_ARGS \
        > "$VALIDATOR_LOG" 2>&1 &

    VALIDATOR_PID=$!

    # Confirm process is alive
    sleep 1
    if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
        log_error "Validator failed to launch (check $VALIDATOR_LOG)."
        exit 1
    fi

    # Wait for JSON-RPC to respond
    if ! wait_for_validator "$RPC_URL"; then
        log_warning "Validator didn’t start properly, retrying once..."
        stop_validator
        sleep 2
        start_validator_with_mock_transfer_program "$RPC_PORT" "$@"
    fi
}

stop_validator() {
    if [ -n "$VALIDATOR_PID" ] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
        log_info "Stopping validator PID $VALIDATOR_PID"
        kill "$VALIDATOR_PID" 2>/dev/null || true
        wait "$VALIDATOR_PID" 2>/dev/null || true
    else
        # No tracked PID – check for any process on this port
        local PID_ON_PORT
        PID_ON_PORT=$(lsof -ti tcp:$BASE_RPC_PORT 2>/dev/null || true)
        if [ -n "$PID_ON_PORT" ]; then
            log_warning "Killing existing validator (PID $PID_ON_PORT) on port $BASE_RPC_PORT"
            kill -9 "$PID_ON_PORT" 2>/dev/null || true
            wait "$PID_ON_PORT" 2>/dev/null || true
        fi
    fi

    VALIDATOR_PID=""

    if [ -n "$LEDGER_DIR" ]; then
        rm -rf "$LEDGER_DIR"
        LEDGER_DIR=""
    fi

    wait_for_port_release "$BASE_RPC_PORT"
}

wait_for_validator() {
    local RPC_URL=$1
    local RETRIES=15
    local SLEEP_TIME=2

    for ((i=1; i<=RETRIES; i++)); do
        if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
            log_error "Validator process died unexpectedly (see $VALIDATOR_LOG)."
            return 1
        fi

        RESPONSE=$(curl -s -X POST "$RPC_URL" \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}')

        if echo "$RESPONSE" | grep -q "solana-core"; then
            log_success "Validator is up at $RPC_URL"
            return 0
        fi

        log_info "Waiting for validator at $RPC_URL (Attempt $i/$RETRIES)..."
        sleep $SLEEP_TIME
    done

    return 1
}

wait_for_port_release() {
    local PORT=$1
    local RETRIES=10
    local SLEEP_TIME=1

    for ((i=1; i<=RETRIES; i++)); do
        if ! lsof -i :$PORT >/dev/null 2>&1; then
            log_info "Port $PORT is free."
            return 0
        fi

        log_info "Waiting for port $PORT to be free (Attempt $i/$RETRIES)..."
        sleep $SLEEP_TIME
    done

    log_error "Port $PORT did not become free after $RETRIES attempts."
    exit 1
}

wait_for_local_oracle() {
    local ORACLE_URL=$1
    local RETRIES=15
    local SLEEP_TIME=1

    for ((i=1; i<=RETRIES; i++)); do
        if [ -n "$LOCAL_ORACLE_PID" ] && ! kill -0 "$LOCAL_ORACLE_PID" 2>/dev/null; then
            log_error "Local oracle process died unexpectedly (see $LOCAL_ORACLE_LOG)."
            return 1
        fi

        if curl -fsS "$ORACLE_URL" > /dev/null 2>&1; then
            log_success "Local oracle is up at $ORACLE_URL"
            return 0
        fi

        log_info "Waiting for local oracle at $ORACLE_URL (Attempt $i/$RETRIES)..."
        sleep $SLEEP_TIME
    done

    return 1
}

configure_e2e_runtime_config() {
    local ORACLE_PUBKEY=$1
    local ORACLE_ENDPOINT=$2
    local E2E_CONFIG_PATH="$SCRIPT_DIR/e2e/cli/config.json"

    if [ ! -f "$E2E_CONFIG_PATH" ]; then
        log_error "Missing e2e config at $E2E_CONFIG_PATH"
        return 1
    fi

    node - "$E2E_CONFIG_PATH" "$ORACLE_PUBKEY" "$ORACLE_ENDPOINT" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
const oraclePubkey = process.argv[3];
const oracleEndpoint = process.argv[4];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

config.double_zero_program_id = "dzrevZC94tBLwuHw1dyynZxaXTWyp7yocsinyEVPtt4";
config.oracle_pubkey = oraclePubkey;
config.price_oracle_end_point = oracleEndpoint;

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

    log_success "E2E config updated for local validator and local oracle."
}

start_local_oracle() {
    local DEFAULT_ORACLE_PORT=18080
    local ORACLE_PATH="/qa-release/api/v1/swap-rate"

    stop_local_oracle

    LOCAL_ORACLE_PORT="$DEFAULT_ORACLE_PORT"
    while lsof -i :"$LOCAL_ORACLE_PORT" >/dev/null 2>&1; do
        LOCAL_ORACLE_PORT=$((LOCAL_ORACLE_PORT + 1))
    done

    LOCAL_ORACLE_KEYPAIR=$(mktemp)
    solana-keygen new --no-bip39-passphrase --silent --force --outfile "$LOCAL_ORACLE_KEYPAIR" >/dev/null
    local ORACLE_PUBKEY
    ORACLE_PUBKEY=$(solana-keygen pubkey "$LOCAL_ORACLE_KEYPAIR")
    local ORACLE_ENDPOINT="http://127.0.0.1:${LOCAL_ORACLE_PORT}${ORACLE_PATH}"

    log_info "Starting local oracle on $ORACLE_ENDPOINT"
    node "$SCRIPT_DIR/e2e/scripts/local-oracle.cjs" \
        --keypair "$LOCAL_ORACLE_KEYPAIR" \
        --host "127.0.0.1" \
        --port "$LOCAL_ORACLE_PORT" \
        --path "$ORACLE_PATH" \
        > "$LOCAL_ORACLE_LOG" 2>&1 &

    LOCAL_ORACLE_PID=$!
    sleep 1

    if ! kill -0 "$LOCAL_ORACLE_PID" 2>/dev/null; then
        log_error "Local oracle failed to launch (see $LOCAL_ORACLE_LOG)."
        return 1
    fi

    if ! wait_for_local_oracle "$ORACLE_ENDPOINT"; then
        log_error "Local oracle did not become ready (see $LOCAL_ORACLE_LOG)."
        return 1
    fi

    configure_e2e_runtime_config "$ORACLE_PUBKEY" "$ORACLE_ENDPOINT"
}

stop_local_oracle() {
    if [ -n "$LOCAL_ORACLE_PID" ] && kill -0 "$LOCAL_ORACLE_PID" 2>/dev/null; then
        log_info "Stopping local oracle PID $LOCAL_ORACLE_PID"
        kill "$LOCAL_ORACLE_PID" 2>/dev/null || true
        wait "$LOCAL_ORACLE_PID" 2>/dev/null || true
    fi

    LOCAL_ORACLE_PID=""
    LOCAL_ORACLE_PORT=""

    if [ -n "$LOCAL_ORACLE_KEYPAIR" ] && [ -f "$LOCAL_ORACLE_KEYPAIR" ]; then
        rm -f "$LOCAL_ORACLE_KEYPAIR"
    fi
    LOCAL_ORACLE_KEYPAIR=""
}

cleanup() {
    stop_local_oracle
    stop_validator
    killall -9 solana-test-validator 2>/dev/null || true
}

# Cleanup on script exit.
trap 'cleanup' EXIT INT TERM

# -------------------- Program Management --------------------
build_anchor_program() {
    local PROGRAM_NAME=$1
    log_info "Building the $PROGRAM_NAME program..."
    anchor build > /dev/null
    yarn install > /dev/null
}

build_native_program() {
    local PROGRAM_NAME=$1
    log_info "Building the $PROGRAM_NAME program..."
    cargo build-sbf > /dev/null
}

deploy_anchor_program() {
    local RPC_URL=$1
    local PROGRAM_NAME=$2
    local CONVERTER_PROGRAM_PRIVATE_KEY="[88,12,53,120,196,208,4,193,202,237,81,120,71,28,31,224,41,207,
    76,0,99,32,173,9,43,131,184,51,4,250,93,103,8,40,223,86,126,86,244,129,130,52,229,
    190,48,74,233,221,131,198,112,195,129,221,203,25,177,111,111,25,201,69,205,115]"
    # Create a temporary keypair file
    local KEYPAIR_FILE
    KEYPAIR_FILE=$(mktemp)

    # Write the private key to the temp file
    echo "$CONVERTER_PROGRAM_PRIVATE_KEY" > "$KEYPAIR_FILE"

    log_info "Deploying $PROGRAM_NAME program to $RPC_URL"
    anchor deploy \
        --provider.cluster "$RPC_URL" \
        --program-name "$PROGRAM_NAME" \
        --program-keypair "$KEYPAIR_FILE"

    # Remove the temp file after deployment
    rm -f "$KEYPAIR_FILE"
}

# -------------------- CLI Management --------------------
build_cli() {
    log_info "Running cargo build for the CLIs..."
    cargo build > /dev/null
    log_success "CLI built successfully"
}

copy_cli_to_e2e() {
    # Remove the existing CLI directory
    rm -rf $SCRIPT_DIR/e2e/cli

    log_info "Copying the CLI binaries to the E2E directory..."
    mkdir -p $SCRIPT_DIR/e2e/cli
    cp $SCRIPT_DIR/target/debug/admin-cli $SCRIPT_DIR/e2e/cli/
    cp $SCRIPT_DIR/target/debug/user-cli $SCRIPT_DIR/e2e/cli/
    cp $SCRIPT_DIR/target/debug/integration-cli $SCRIPT_DIR/e2e/cli/
    cp $SCRIPT_DIR/config.json $SCRIPT_DIR/e2e/cli/
    log_success "CLI copied to the E2E directory"
}

# -------------------- Test Runner --------------------
run_test() {
    local TEST_SCRIPT=$1
    local RPC_PORT=$2
    local RPC_URL="http://127.0.0.1:$RPC_PORT"

    print_status_bar
    log_section "Running Test: $TEST_SCRIPT (RPC: $RPC_PORT)"

    EXTRA_ARGS=""
    if [ "$TEST_SCRIPT" == "user-flow" ]; then
        EXTRA_ARGS="--ticks-per-slot 300"
    fi
    start_validator_with_mock_transfer_program $RPC_PORT $EXTRA_ARGS

    # Deploy the programs to the validator
    cd $SCRIPT_DIR/mock-double-zero-program || exit 1
    cd $SCRIPT_DIR/on-chain || exit 1
    deploy_anchor_program $RPC_URL "converter-program" || { log_error "Deploy failed"; exit 1; }

    if [ "$TEST_TYPE" == "e2e" ]; then
        cd $SCRIPT_DIR/e2e || exit 1
        set +e
        npm run $TEST_SCRIPT
        RESULT=$?
        set -e
    else
        set +e
        anchor run $TEST_SCRIPT --provider.cluster $RPC_URL
        RESULT=$?
        set -e
    fi

    if [ $RESULT -eq 0 ]; then
        log_success "Test Passed: $TEST_SCRIPT"
    else
        log_error "Test Failed: $TEST_SCRIPT"
        if [ -f "$VALIDATOR_LOG" ]; then
            log_warning "Last 80 lines of $VALIDATOR_LOG"
            tail -n 80 "$VALIDATOR_LOG" || true
        fi
        if [ -f "$LOCAL_ORACLE_LOG" ]; then
            log_warning "Last 80 lines of $LOCAL_ORACLE_LOG"
            tail -n 80 "$LOCAL_ORACLE_LOG" || true
        fi
        FAILED_TESTS+=("$TEST_SCRIPT")
        FAILED_COUNT=$((FAILED_COUNT + 1))
    fi

    COMPLETED_COUNT=$((COMPLETED_COUNT + 1))
    print_status_bar
    echo ""
    cd $SCRIPT_DIR || exit 1
}

# -------------------- Main Execution --------------------
print_header
# Ensure no leftover validator is running before we start
stop_validator

# Build the double zero converter program
cd ./on-chain || exit 1
build_anchor_program "converter-program"

# Build the mock double zero transfer program
cd $SCRIPT_DIR/mock-double-zero-program || exit 1
build_native_program "mock-double-zero-program"
cd $SCRIPT_DIR

# Build the admin and user CLI
if [ "$TEST_TYPE" == "e2e" ]; then
    build_cli
    copy_cli_to_e2e

    # Install the dependencies for the e2e test suite
    cd $SCRIPT_DIR/e2e || exit 1
    npm install > /dev/null
    cd $SCRIPT_DIR

    start_local_oracle
fi

for TEST_SCRIPT in "${ACTIVE_TESTS[@]}"; do
    run_test $TEST_SCRIPT $BASE_RPC_PORT
done

# -------------------- Summary --------------------
echo ""
print_status_bar
echo ""

if [ ${#FAILED_TESTS[@]} -eq 0 ]; then
    log_success "All $TEST_TYPE tests passed successfully. 🎉"
else
    log_warning "Some $TEST_TYPE tests failed:"
    for FAILED_TEST in "${FAILED_TESTS[@]}"; do
        echo -e "✖️  \033[38;5;203m$FAILED_TEST\033[0m"
    done
fi

print_footer

# Stop any running validators
stop_validator

if [ $FAILED_COUNT -gt 0 ]; then
    exit 1
else
    exit 0
fi
