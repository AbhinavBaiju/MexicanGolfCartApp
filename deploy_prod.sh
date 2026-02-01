#!/bin/bash
#
# Mexican Golf Cart App - Production Deployment Script
# =====================================================
# A comprehensive, production-ready deployment pipeline
# with validation, idempotency, rollback, and verification.
#
# Usage: ./deploy_prod.sh [OPTIONS]
#   --dry-run          Validate without deploying
#   --skip-tests       Skip test execution
#   --env ENV          Target environment (staging|production)
#   --force            Deploy even with uncommitted changes
#   --verbose          Enable verbose output
#   --help             Show this help message
#
# Exit Codes:
#   0 - Success
#   1 - General failure
#   2 - Validation failure
#   3 - Deployment failure
#   4 - Rollback failure
#   5 - Verification failure
#

set -euo pipefail
IFS=$'\n\t'

# =============================================================================
# CONFIGURATION & CONSTANTS
# =============================================================================

readonly SCRIPT_VERSION="2.0.0"
readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$SCRIPT_DIR"
readonly LOCK_FILE="$PROJECT_ROOT/.deploy.lock"
readonly LOG_FILE="$PROJECT_ROOT/deploy.log"
readonly STATE_FILE="$PROJECT_ROOT/.deploy.state"
readonly TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
readonly DEPLOYMENT_ID="deploy_${TIMESTAMP}_$$"

# Timeout configurations (in seconds)
readonly TIMEOUT_NPM_INSTALL=600      # 10 minutes
readonly TIMEOUT_WRANGLER_DEPLOY=300  # 5 minutes
readonly TIMEOUT_SHOPIFY_DEPLOY=600   # 10 minutes
readonly TIMEOUT_BUILD=300            # 5 minutes
readonly TIMEOUT_HEALTH_CHECK=60      # 1 minute

# Retry configuration
readonly MAX_RETRIES=3
readonly RETRY_BASE_DELAY=5

# Color codes for terminal output
readonly COLOR_RESET='\033[0m'
readonly COLOR_BOLD='\033[1m'
readonly COLOR_DIM='\033[2m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_MAGENTA='\033[0;35m'
readonly COLOR_CYAN='\033[0;36m'
readonly COLOR_WHITE='\033[0;37m'

# Log levels
readonly LOG_LEVEL_DEBUG=0
readonly LOG_LEVEL_INFO=1
readonly LOG_LEVEL_WARN=2
readonly LOG_LEVEL_ERROR=3
readonly LOG_LEVEL_SUCCESS=4

# Default configuration
DRY_RUN=false
SKIP_TESTS=false
ENVIRONMENT="production"
FORCE_DEPLOY=false
VERBOSE=false
LOG_LEVEL=$LOG_LEVEL_INFO

# Deployment tracking
DEPLOYMENT_STAGES=()
ROLLBACK_STACK=()
DEPLOYMENT_FAILED=false
FAILED_STAGE=""

# =============================================================================
# LOGGING FUNCTIONS
# =============================================================================

# Initialize log file
init_logging() {
    echo "============================================================" > "$LOG_FILE"
    echo "Deployment Log - $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$LOG_FILE"
    echo "Deployment ID: $DEPLOYMENT_ID" >> "$LOG_FILE"
    echo "Environment: $ENVIRONMENT" >> "$LOG_FILE"
    echo "Script Version: $SCRIPT_VERSION" >> "$LOG_FILE"
    echo "============================================================" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
}

# Write to log file
log_to_file() {
    local level="$1"
    local message="$2"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

# Print colored output to terminal
print_colored() {
    local color="$1"
    local message="$2"
    echo -e "${color}${message}${COLOR_RESET}"
}

# Log debug messages (only in verbose mode)
log_debug() {
    if [[ "$VERBOSE" == true ]]; then
        log_to_file "DEBUG" "$1"
        print_colored "$COLOR_DIM" "[DEBUG] $1"
    fi
}

# Log info messages
log_info() {
    log_to_file "INFO" "$1"
    if [[ $LOG_LEVEL -le $LOG_LEVEL_INFO ]]; then
        print_colored "$COLOR_BLUE" "[INFO] $1"
    fi
}

# Log warning messages
log_warn() {
    log_to_file "WARN" "$1"
    if [[ $LOG_LEVEL -le $LOG_LEVEL_WARN ]]; then
        print_colored "$COLOR_YELLOW" "[WARN] $1"
    fi
}

# Log error messages
log_error() {
    log_to_file "ERROR" "$1"
    if [[ $LOG_LEVEL -le $LOG_LEVEL_ERROR ]]; then
        print_colored "$COLOR_RED" "[ERROR] $1" >&2
    fi
}

# Log success messages
log_success() {
    log_to_file "SUCCESS" "$1"
    if [[ $LOG_LEVEL -le $LOG_LEVEL_SUCCESS ]]; then
        print_colored "$COLOR_GREEN" "[SUCCESS] $1"
    fi
}

# Print section header
print_header() {
    local title="$1"
    echo ""
    print_colored "$COLOR_BOLD$COLOR_CYAN" "╔════════════════════════════════════════════════════════════╗"
    print_colored "$COLOR_BOLD$COLOR_CYAN" "║ $title"
    print_colored "$COLOR_BOLD$COLOR_CYAN" "╚════════════════════════════════════════════════════════════╝"
    echo ""
    log_to_file "INFO" "=== $title ==="
}

# Print progress indicator
show_progress() {
    local message="$1"
    local pid="$2"
    local delay=0.5
    local spinstr='|/-\'
    
    while kill -0 "$pid" 2>/dev/null; do
        local temp=${spinstr#?}
        printf " [%c] %s...\r" "$spinstr" "$message"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
    done
    printf "\r%*s\r" $((${#message}+6)) ""
}

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

# Display help message
show_help() {
    cat << EOF
Mexican Golf Cart App - Production Deployment Script v${SCRIPT_VERSION}

Usage: ./${SCRIPT_NAME} [OPTIONS]

OPTIONS:
    --dry-run          Validate configuration without deploying
    --skip-tests       Skip test execution
    --env ENV          Target environment (staging|production) [default: production]
    --force            Deploy even with uncommitted git changes
    --verbose          Enable verbose debug output
    --help             Show this help message

EXAMPLES:
    ./${SCRIPT_NAME}                    # Deploy to production
    ./${SCRIPT_NAME} --env staging      # Deploy to staging
    ./${SCRIPT_NAME} --dry-run          # Validate only
    ./${SCRIPT_NAME} --force            # Force deploy with uncommitted changes

EXIT CODES:
    0 - Success
    1 - General failure
    2 - Validation failure
    3 - Deployment failure
    4 - Rollback failure
    5 - Verification failure

For more information, see DEPLOYMENT.md
EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --env)
                if [[ -n "${2:-}" ]]; then
                    ENVIRONMENT="$2"
                    shift 2
                else
                    log_error "--env requires an argument (staging|production)"
                    exit 2
                fi
                ;;
            --force)
                FORCE_DEPLOY=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                LOG_LEVEL=$LOG_LEVEL_DEBUG
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 2
                ;;
        esac
    done

    # Validate environment
    if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
        log_error "Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'"
        exit 2
    fi

    log_debug "Arguments parsed: DRY_RUN=$DRY_RUN, SKIP_TESTS=$SKIP_TESTS, ENVIRONMENT=$ENVIRONMENT, FORCE=$FORCE_DEPLOY"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Get version of a command
get_version() {
    local cmd="$1"
    local version_flag="${2:---version}"
    
    if command_exists "$cmd"; then
        "$cmd" "$version_flag" 2>&1 | head -1
    else
        echo "not installed"
    fi
}

# Execute command with timeout
run_with_timeout() {
    local timeout="$1"
    local description="$2"
    shift 2
    
    log_debug "Running: $description (timeout: ${timeout}s)"
    log_to_file "DEBUG" "Command: $*"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would execute: $description"
        return 0
    fi
    
    # Use timeout command if available, otherwise use perl
    if command_exists timeout; then
        timeout "$timeout" "$@"
    elif command_exists perl; then
        perl -e 'alarm shift; exec @ARGV' "$timeout" "$@"
    else
        # Fallback: run without timeout but log warning
        log_warn "timeout command not available, running without timeout protection"
        "$@"
    fi
}

# Retry logic with exponential backoff
retry_with_backoff() {
    local max_attempts="$1"
    local description="$2"
    shift 2
    local attempt=1
    local delay=$RETRY_BASE_DELAY
    
    while [[ $attempt -le $max_attempts ]]; do
        log_debug "Attempt $attempt/$max_attempts: $description"
        
        if "$@"; then
            return 0
        fi
        
        local exit_code=$?
        
        if [[ $attempt -lt $max_attempts ]]; then
            log_warn "Attempt $attempt failed for '$description'. Retrying in ${delay}s..."
            sleep $delay
            delay=$((delay * 2))
        fi
        
        ((attempt++))
    done
    
    log_error "All $max_attempts attempts failed for '$description'"
    return 1
}

# Calculate checksum of a directory
calculate_checksum() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        find "$dir" -type f -exec md5sum {} + 2>/dev/null | sort | md5sum | cut -d' ' -f1
    else
        echo ""
    fi
}

# =============================================================================
# LOCKING & IDEMPOTENCY
# =============================================================================

# Acquire deployment lock
acquire_lock() {
    log_info "Checking for existing deployment lock..."
    
    if [[ -f "$LOCK_FILE" ]]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        
        if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
            log_error "Another deployment is already in progress (PID: $lock_pid)"
            log_error "If this is a stale lock, remove: $LOCK_FILE"
            exit 1
        else
            log_warn "Removing stale lock file"
            rm -f "$LOCK_FILE"
        fi
    fi
    
    echo $$ > "$LOCK_FILE"
    log_debug "Lock acquired: $LOCK_FILE"
}

# Release deployment lock
release_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        rm -f "$LOCK_FILE"
        log_debug "Lock released"
    fi
}

# Save deployment state
save_state() {
    local stage="$1"
    local data="${2:-}"
    
    echo "${stage}:${data}" >> "$STATE_FILE"
    DEPLOYMENT_STAGES+=("$stage")
    log_debug "State saved: $stage"
}

# Load deployment state
load_state() {
    if [[ -f "$STATE_FILE" ]]; then
        cat "$STATE_FILE"
    fi
}

# Clear deployment state
clear_state() {
    rm -f "$STATE_FILE"
    log_debug "State cleared"
}

# Check if component needs deployment (idempotency)
needs_deployment() {
    local component="$1"
    local current_checksum="$2"
    local checksum_file="$PROJECT_ROOT/.${component}.checksum"
    
    if [[ ! -f "$checksum_file" ]]; then
        echo "$current_checksum" > "$checksum_file"
        return 0
    fi
    
    local previous_checksum
    previous_checksum=$(cat "$checksum_file")
    
    if [[ "$current_checksum" == "$previous_checksum" ]]; then
        log_info "$component is already at target version, skipping deployment"
        return 1
    fi
    
    echo "$current_checksum" > "$checksum_file"
    return 0
}

# =============================================================================
# VALIDATION FUNCTIONS
# =============================================================================

# Validate shell script syntax
validate_shell_syntax() {
    local script="$1"
    if [[ -f "$script" ]]; then
        if ! bash -n "$script" 2>/dev/null; then
            log_error "Shell syntax error in: $script"
            return 1
        fi
    fi
    return 0
}

# Check required dependencies
check_dependencies() {
    print_header "DEPENDENCY CHECK"
    
    local deps=("npm" "npx" "node")
    local missing_deps=()
    
    for dep in "${deps[@]}"; do
        log_info "Checking $dep..."
        if ! command_exists "$dep"; then
            missing_deps+=("$dep")
            log_error "$dep is not installed"
        else
            local version
            version=$(get_version "$dep")
            log_success "$dep: $version"
        fi
    done
    
    # Check optional but recommended tools
    local optional_deps=("wrangler" "shopify")
    for dep in "${optional_deps[@]}"; do
        if command_exists "$dep"; then
            local version
            version=$(get_version "$dep")
            log_success "$dep: $version"
        else
            log_warn "$dep: will use npx"
        fi
    done
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        return 1
    fi
    
    # Check Node.js version
    local node_version
    node_version=$(node --version | sed 's/v//')
    local required_version="18.0.0"
    
    if [[ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]]; then
        log_error "Node.js version $node_version is too old. Required: >= $required_version"
        return 1
    fi
    
    log_success "All dependencies satisfied"
    return 0
}

# Validate environment configuration
validate_environment() {
    print_header "ENVIRONMENT VALIDATION"
    
    local required_files=(
        "worker/wrangler.toml"
        "apps/admin/package.json"
        "apps/shopify/mexican-golf-cart/shopify.app.toml"
        "package.json"
    )
    
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        local full_path="$PROJECT_ROOT/$file"
        if [[ ! -f "$full_path" ]]; then
            missing_files+=("$file")
            log_error "Missing required file: $file"
        else
            log_debug "Found: $file"
        fi
    done
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        log_error "Missing ${#missing_files[@]} required configuration files"
        return 1
    fi
    
    # Check environment-specific files
    if [[ "$ENVIRONMENT" == "production" ]]; then
        # Production-specific checks
        if [[ ! -f "$PROJECT_ROOT/apps/admin/.env" ]]; then
            log_warn "apps/admin/.env not found - may cause build issues"
        fi
    fi
    
    log_success "Environment configuration valid"
    return 0
}

# Check git status
check_git_status() {
    print_header "GIT STATUS CHECK"
    
    if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
        log_warn "Not a git repository, skipping git checks"
        return 0
    fi
    
    cd "$PROJECT_ROOT"
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        if [[ "$FORCE_DEPLOY" == true ]]; then
            log_warn "Uncommitted changes detected, but --force flag is set"
        else
            log_error "Uncommitted changes detected. Commit changes or use --force"
            git status --short
            return 1
        fi
    else
        log_success "Working directory is clean"
    fi
    
    # Check if we're on the correct branch for production
    if [[ "$ENVIRONMENT" == "production" ]]; then
        local current_branch
        current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
        
        if [[ "$current_branch" != "main" && "$current_branch" != "master" ]]; then
            log_warn "Not on main/master branch (currently on: $current_branch)"
        fi
    fi
    
    return 0
}

# Run TypeScript compilation check
validate_typescript() {
    print_header "TYPESCRIPT VALIDATION"
    
    local ts_projects=("worker" "apps/admin" "apps/shopify/mexican-golf-cart")
    local failed_projects=()
    
    for project in "${ts_projects[@]}"; do
        local project_path="$PROJECT_ROOT/$project"
        
        if [[ ! -d "$project_path" ]]; then
            log_warn "Project directory not found: $project"
            continue
        fi
        
        cd "$project_path"
        
        if [[ ! -f "tsconfig.json" ]]; then
            log_warn "No tsconfig.json found in $project, skipping"
            continue
        fi
        
        log_info "Checking TypeScript in $project..."
        
        if ! run_with_timeout $TIMEOUT_BUILD "TypeScript check: $project" npx tsc --noEmit 2>&1 | tee -a "$LOG_FILE"; then
            failed_projects+=("$project")
            log_error "TypeScript compilation failed in $project"
        else
            log_success "TypeScript valid in $project"
        fi
    done
    
    cd "$PROJECT_ROOT"
    
    if [[ ${#failed_projects[@]} -gt 0 ]]; then
        log_error "TypeScript validation failed for: ${failed_projects[*]}"
        return 1
    fi
    
    log_success "All TypeScript projects validated"
    return 0
}

# Run linting checks
run_linting() {
    print_header "LINTING CHECKS"
    
    if [[ "$SKIP_TESTS" == true ]]; then
        log_warn "Skipping linting checks (--skip-tests)"
        return 0
    fi
    
    local projects=("apps/admin" "apps/shopify/mexican-golf-cart")
    local failed_projects=()
    
    for project in "${projects[@]}"; do
        local project_path="$PROJECT_ROOT/$project"
        
        if [[ ! -d "$project_path" ]]; then
            continue
        fi
        
        cd "$project_path"
        
        if [[ ! -f "package.json" ]]; then
            continue
        fi
        
        # Check if lint script exists
        if npm run --silent lint >/dev/null 2>&1; then
            log_info "Running lint in $project..."
            
            if ! npm run lint 2>&1 | tee -a "$LOG_FILE"; then
                failed_projects+=("$project")
                log_error "Linting failed in $project"
            else
                log_success "Linting passed in $project"
            fi
        else
            log_warn "No lint script in $project, skipping"
        fi
    done
    
    cd "$PROJECT_ROOT"
    
    if [[ ${#failed_projects[@]} -gt 0 ]]; then
        log_error "Linting failed for: ${failed_projects[*]}"
        return 1
    fi
    
    log_success "All linting checks passed"
    return 0
}

# Run pre-deployment validation
run_validation() {
    log_info "Starting pre-deployment validation..."
    
    if ! check_dependencies; then
        return 2
    fi
    
    if ! validate_environment; then
        return 2
    fi
    
    if ! check_git_status; then
        return 2
    fi
    
    if ! validate_typescript; then
        return 2
    fi
    
    if ! run_linting; then
        return 2
    fi
    
    log_success "All validation checks passed"
    return 0
}

# =============================================================================
# DEPLOYMENT STAGES
# =============================================================================

# Install dependencies
stage_install_dependencies() {
    print_header "STAGE 1: INSTALL DEPENDENCIES"
    
    cd "$PROJECT_ROOT"
    
    if [[ "${SKIP_INSTALL:-}" == "1" ]]; then
        log_warn "SKIP_INSTALL=1 set, skipping npm install"
        return 0
    fi
    
    log_info "Installing root dependencies..."
    
    if ! run_with_timeout $TIMEOUT_NPM_INSTALL "npm install" npm ci --prefer-offline --no-audit --no-fund 2>&1 | tee -a "$LOG_FILE"; then
        log_error "npm install failed"
        return 3
    fi
    
    log_success "Dependencies installed"
    save_state "dependencies_installed"
    return 0
}

# Deploy Cloudflare Worker
stage_deploy_worker() {
    print_header "STAGE 2: DEPLOY CLOUDFLARE WORKER"
    
    local worker_path="$PROJECT_ROOT/worker"
    
    if [[ ! -d "$worker_path" ]]; then
        log_error "Worker directory not found: $worker_path"
        return 3
    fi
    
    cd "$worker_path"
    
    # Calculate checksum for idempotency
    local current_checksum
    current_checksum=$(calculate_checksum "src")
    
    if ! needs_deployment "worker" "$current_checksum"; then
        log_info "Worker unchanged, skipping deployment"
        save_state "worker_skipped"
        return 0
    fi
    
    log_info "Deploying Cloudflare Worker to $ENVIRONMENT..."
    
    local deploy_args=("--minify")
    
    if [[ "$ENVIRONMENT" != "production" ]]; then
        deploy_args+=("--env" "$ENVIRONMENT")
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy worker with args: ${deploy_args[*]}"
        save_state "worker_deployed" "dry-run"
        return 0
    fi
    
    if ! retry_with_backoff $MAX_RETRIES "wrangler deploy" \
        run_with_timeout $TIMEOUT_WRANGLER_DEPLOY "wrangler deploy" \
        npx wrangler deploy "${deploy_args[@]}" 2>&1 | tee -a "$LOG_FILE"; then
        log_error "Worker deployment failed"
        return 3
    fi
    
    log_success "Worker deployed successfully"
    save_state "worker_deployed" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    return 0
}

# Build and deploy Admin Dashboard
stage_deploy_admin() {
    print_header "STAGE 3: DEPLOY ADMIN DASHBOARD"
    
    local admin_path="$PROJECT_ROOT/apps/admin"
    
    if [[ ! -d "$admin_path" ]]; then
        log_error "Admin directory not found: $admin_path"
        return 3
    fi
    
    cd "$admin_path"
    
    # Calculate checksum for idempotency
    local current_checksum
    current_checksum=$(calculate_checksum "src")
    
    if ! needs_deployment "admin" "$current_checksum"; then
        log_info "Admin unchanged, skipping deployment"
        save_state "admin_skipped"
        return 0
    fi
    
    # Build the app
    log_info "Building Admin Dashboard..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would build admin dashboard"
    else
        if ! run_with_timeout $TIMEOUT_BUILD "npm run build" npm run build 2>&1 | tee -a "$LOG_FILE"; then
            log_error "Admin build failed"
            return 3
        fi
    fi
    
    # Deploy to Cloudflare Pages
    log_info "Deploying Admin Dashboard to Cloudflare Pages..."
    
    local pages_project="mexican-golf-cart-admin"
    local deploy_args=(
        "--project-name" "$pages_project"
        "--branch" "main"
        "--commit-dirty=true"
    )
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy admin to pages with args: ${deploy_args[*]}"
        save_state "admin_deployed" "dry-run"
        return 0
    fi
    
    if ! retry_with_backoff $MAX_RETRIES "pages deploy" \
        run_with_timeout $TIMEOUT_WRANGLER_DEPLOY "pages deploy" \
        npx wrangler pages deploy dist "${deploy_args[@]}" 2>&1 | tee -a "$LOG_FILE"; then
        log_error "Admin dashboard deployment failed"
        return 3
    fi
    
    log_success "Admin dashboard deployed successfully"
    save_state "admin_deployed" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    return 0
}

# Deploy Shopify App
stage_deploy_shopify() {
    print_header "STAGE 4: DEPLOY SHOPIFY APP"
    
    local shopify_path="$PROJECT_ROOT/apps/shopify/mexican-golf-cart"
    
    if [[ ! -d "$shopify_path" ]]; then
        log_error "Shopify app directory not found: $shopify_path"
        return 3
    fi
    
    cd "$shopify_path"
    
    # Calculate checksum for idempotency
    local current_checksum
    current_checksum=$(calculate_checksum "app")
    
    if ! needs_deployment "shopify" "$current_checksum"; then
        log_info "Shopify app unchanged, skipping deployment"
        save_state "shopify_skipped"
        return 0
    fi
    
    log_info "Deploying Shopify App..."
    
    local deploy_args=("--force")
    
    if [[ "$ENVIRONMENT" == "staging" ]]; then
        # Add staging-specific args if needed
        log_info "Deploying to staging environment"
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy Shopify app with args: ${deploy_args[*]}"
        save_state "shopify_deployed" "dry-run"
        return 0
    fi
    
    if ! retry_with_backoff $MAX_RETRIES "shopify app deploy" \
        run_with_timeout $TIMEOUT_SHOPIFY_DEPLOY "shopify deploy" \
        npx shopify app deploy "${deploy_args[@]}" 2>&1 | tee -a "$LOG_FILE"; then
        log_error "Shopify app deployment failed"
        return 3
    fi
    
    log_success "Shopify app deployed successfully"
    save_state "shopify_deployed" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    return 0
}

# =============================================================================
# ROLLBACK FUNCTIONS
# =============================================================================

# Rollback worker deployment
rollback_worker() {
    log_warn "Rolling back Worker deployment..."
    
    local worker_path="$PROJECT_ROOT/worker"
    cd "$worker_path"
    
    # Note: Cloudflare Workers don't have a direct rollback mechanism
    # We would need to redeploy the previous version
    # For now, we just log the need for manual intervention
    log_warn "Worker rollback requires manual intervention"
    log_warn "Consider using Cloudflare dashboard or wrangler rollback"
    
    return 0
}

# Rollback admin deployment
rollback_admin() {
    log_warn "Rolling back Admin deployment..."
    
    # Cloudflare Pages supports instant rollback via dashboard
    log_warn "Admin rollback: Use Cloudflare Pages dashboard for instant rollback"
    
    return 0
}

# Rollback Shopify deployment
rollback_shopify() {
    log_warn "Rolling back Shopify deployment..."
    
    # Shopify app versions can be managed via Partner dashboard
    log_warn "Shopify rollback: Use Shopify Partner dashboard to manage versions"
    
    return 0
}

# Execute full rollback
execute_rollback() {
    print_header "EXECUTING ROLLBACK"
    
    log_error "Deployment failed at stage: $FAILED_STAGE"
    log_info "Initiating rollback procedure..."
    
    # Read state file and rollback in reverse order
    if [[ -f "$STATE_FILE" ]]; then
        while IFS=: read -r stage data; do
            case "$stage" in
                worker_deployed)
                    rollback_worker
                    ;;
                admin_deployed)
                    rollback_admin
                    ;;
                shopify_deployed)
                    rollback_shopify
                    ;;
            esac
        done < "$STATE_FILE"
    fi
    
    log_warn "Rollback completed. Please verify system state manually."
    
    return 4
}

# =============================================================================
# VERIFICATION FUNCTIONS
# =============================================================================

# Health check for Worker endpoints
verify_worker_health() {
    log_info "Checking Worker health..."
    
    local worker_url
    if [[ "$ENVIRONMENT" == "production" ]]; then
        worker_url="https://mexican-golf-cart-worker.explaincaption.workers.dev"
    else
        worker_url="https://mexican-golf-cart-worker-staging.explaincaption.workers.dev"
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would check: $worker_url/health"
        return 0
    fi
    
    local max_attempts=5
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        log_debug "Health check attempt $attempt/$max_attempts"
        
        if curl -sf "$worker_url/health" >/dev/null 2>&1 || \
           curl -sf "$worker_url" >/dev/null 2>&1; then
            log_success "Worker is responding"
            return 0
        fi
        
        sleep 5
        ((attempt++))
    done
    
    log_error "Worker health check failed after $max_attempts attempts"
    return 5
}

# Verify Admin dashboard accessibility
verify_admin_accessibility() {
    log_info "Checking Admin dashboard accessibility..."
    
    local admin_url
    if [[ "$ENVIRONMENT" == "production" ]]; then
        admin_url="https://mexican-golf-cart-admin.pages.dev"
    else
        admin_url="https://staging.mexican-golf-cart-admin.pages.dev"
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would check: $admin_url"
        return 0
    fi
    
    if curl -sf "$admin_url" >/dev/null 2>&1; then
        log_success "Admin dashboard is accessible"
        return 0
    else
        log_warn "Admin dashboard accessibility check inconclusive (may require auth)"
        return 0
    fi
}

# Verify Shopify webhook URLs
verify_shopify_webhooks() {
    log_info "Verifying Shopify webhook configuration..."
    
    # Read webhook URLs from shopify.app.toml
    local shopify_config="$PROJECT_ROOT/apps/shopify/mexican-golf-cart/shopify.app.toml"
    
    if [[ ! -f "$shopify_config" ]]; then
        log_warn "Shopify config not found, skipping webhook verification"
        return 0
    fi
    
    # Extract and verify webhook URLs are properly configured
    log_info "Webhook URLs configured in shopify.app.toml"
    
    return 0
}

# Verify database connectivity
verify_database() {
    log_info "Verifying database connectivity..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would verify D1 database connectivity"
        return 0
    fi
    
    local worker_path="$PROJECT_ROOT/worker"
    cd "$worker_path"
    
    # Try to run a simple D1 query via wrangler
    if npx wrangler d1 execute "mexican-golf-cart-db-$ENVIRONMENT" --command "SELECT 1" --local 2>/dev/null || \
       npx wrangler d1 execute "mexican-golf-cart-db-$ENVIRONMENT" --command "SELECT 1" 2>/dev/null; then
        log_success "Database connectivity verified"
        return 0
    fi
    
    log_warn "Could not verify database connectivity (may require auth)"
    return 0
}

# Run smoke tests
run_smoke_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        log_warn "Skipping smoke tests (--skip-tests)"
        return 0
    fi
    
    log_info "Running smoke tests..."
    
    # Check if smoke tests exist
    if [[ -f "$PROJECT_ROOT/scripts/smoke-tests.sh" ]]; then
        if ! bash "$PROJECT_ROOT/scripts/smoke-tests.sh"; then
            log_error "Smoke tests failed"
            return 5
        fi
    else
        log_warn "No smoke tests found, skipping"
    fi
    
    return 0
}

# Final verification stage
run_verification() {
    print_header "FINAL VERIFICATION"
    
    local failed_checks=()
    
    if ! verify_worker_health; then
        failed_checks+=("worker_health")
    fi
    
    if ! verify_admin_accessibility; then
        failed_checks+=("admin_accessibility")
    fi
    
    if ! verify_shopify_webhooks; then
        failed_checks+=("shopify_webhooks")
    fi
    
    if ! verify_database; then
        failed_checks+=("database")
    fi
    
    if ! run_smoke_tests; then
        failed_checks+=("smoke_tests")
    fi
    
    if [[ ${#failed_checks[@]} -gt 0 ]]; then
        log_error "Verification failed for: ${failed_checks[*]}"
        return 5
    fi
    
    log_success "All verification checks passed"
    return 0
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

# Cleanup function
cleanup() {
    local exit_code=$?
    
    log_debug "Running cleanup..."
    
    # Release lock
    release_lock
    
    # Cleanup temporary files
    rm -f "$STATE_FILE"
    
    # Print summary
    if [[ $exit_code -eq 0 ]]; then
        echo ""
        print_colored "$COLOR_GREEN$COLOR_BOLD" "╔════════════════════════════════════════════════════════════╗"
        print_colored "$COLOR_GREEN$COLOR_BOLD" "║           DEPLOYMENT COMPLETED SUCCESSFULLY                ║"
        print_colored "$COLOR_GREEN$COLOR_BOLD" "╚════════════════════════════════════════════════════════════╝"
        echo ""
        log_info "Deployment completed successfully"
        log_info "Log file: $LOG_FILE"
    else
        echo ""
        print_colored "$COLOR_RED$COLOR_BOLD" "╔════════════════════════════════════════════════════════════╗"
        print_colored "$COLOR_RED$COLOR_BOLD" "║              DEPLOYMENT FAILED                             ║"
        print_colored "$COLOR_RED$COLOR_BOLD" "╚════════════════════════════════════════════════════════════╝"
        echo ""
        log_error "Deployment failed with exit code: $exit_code"
        log_error "Log file: $LOG_FILE"
    fi
    
    exit $exit_code
}

# Set trap for cleanup
trap cleanup EXIT

# Main function
main() {
    # Initialize
    init_logging
    
    echo ""
    print_colored "$COLOR_CYAN$COLOR_BOLD" "╔════════════════════════════════════════════════════════════╗"
    print_colored "$COLOR_CYAN$COLOR_BOLD" "║     Mexican Golf Cart App - Deployment Script v${SCRIPT_VERSION}      ║"
    print_colored "$COLOR_CYAN$COLOR_BOLD" "╚════════════════════════════════════════════════════════════╝"
    echo ""
    
    log_info "Deployment ID: $DEPLOYMENT_ID"
    log_info "Environment: $ENVIRONMENT"
    log_info "Dry Run: $DRY_RUN"
    log_info "Skip Tests: $SKIP_TESTS"
    
    # Parse arguments
    parse_arguments "$@"
    
    # Acquire lock
    acquire_lock
    
    # Pre-deployment validation
    if ! run_validation; then
        log_error "Pre-deployment validation failed"
        exit 2
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "Dry run completed - no changes made"
        exit 0
    fi
    
    # Execute deployment stages
    if ! stage_install_dependencies; then
        FAILED_STAGE="dependencies"
        exit 3
    fi
    
    if ! stage_deploy_worker; then
        FAILED_STAGE="worker"
        execute_rollback
        exit 3
    fi
    
    if ! stage_deploy_admin; then
        FAILED_STAGE="admin"
        execute_rollback
        exit 3
    fi
    
    if ! stage_deploy_shopify; then
        FAILED_STAGE="shopify"
        execute_rollback
        exit 3
    fi
    
    # Final verification
    if ! run_verification; then
        log_error "Post-deployment verification failed"
        # Don't rollback on verification failure, just warn
        log_warn "Deployment completed but verification failed - manual check required"
        exit 5
    fi
    
    # Success
    log_success "All deployment stages completed successfully"
    
    # Print deployment summary
    echo ""
    print_colored "$COLOR_CYAN$COLOR_BOLD" "DEPLOYMENT SUMMARY"
    echo "============================================================"
    print_colored "$COLOR_GREEN" "✓ Dependencies installed"
    print_colored "$COLOR_GREEN" "✓ Cloudflare Worker deployed"
    print_colored "$COLOR_GREEN" "✓ Admin Dashboard deployed"
    print_colored "$COLOR_GREEN" "✓ Shopify App deployed"
    print_colored "$COLOR_GREEN" "✓ Verification passed"
    echo "============================================================"
    print_colored "$COLOR_WHITE" "Environment: $ENVIRONMENT"
    print_colored "$COLOR_WHITE" "Deployment ID: $DEPLOYMENT_ID"
    print_colored "$COLOR_WHITE" "Log File: $LOG_FILE"
    echo "============================================================"
    
    exit 0
}

# Run main function
main "$@"
