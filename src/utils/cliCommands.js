/**
 * CLI Commands Configuration
 * 
 * Single source of truth for all CLI commands and their properties.
 * Import this module wherever you need to check CLI command behavior.
 * 
 * ═══════════════════════════════════════════════════════════════
 * HOW TO ADD A NEW CLI COMMAND
 * ═══════════════════════════════════════════════════════════════
 * 
 * 1. Add command to CLI_COMMANDS array below
 * 2. If command should exit without GUI, add to CLI_ONLY_COMMANDS
 * 3. If command should open GUI, add to GUI_COMMANDS
 * 4. Define command in main.js using Commander.js
 * 5. That's it! The command will automatically work everywhere
 * 
 * Example: Adding a new "test" command that exits without GUI
 * 
 *   CLI_COMMANDS: [..., 'test']
 *   CLI_ONLY_COMMANDS: [..., 'test']
 *   
 *   Then in main.js:
 *   program
 *     .command('test <path>')
 *     .description('Test a plugin')
 *     .action(async (path) => {
 *       // Your logic here
 *       app.exit(0);
 *     });
 * 
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * All recognized CLI commands and flags
 * These trigger CLI parsing mode
 */
export const CLI_COMMANDS = [
    'help',
    '--help',
    '-h',
    '--version',
    '-V',
    'open',
    'compile',
    'deploy',
    'sign'
];

/**
 * CLI-only commands that should exit after execution (no GUI)
 * These commands process and exit without opening the GUI window
 */
export const CLI_ONLY_COMMANDS = [
    'help',
    '--help',
    '-h',
    '--version',
    '-V',
    'compile',
    'deploy',
    'sign'
];

/**
 * GUI commands that open the application window
 * These commands may show startup metrics
 */
export const GUI_COMMANDS = [
    'open'
];

/**
 * Check if arguments contain any CLI command
 * @param {string[]} args - Command line arguments
 * @returns {boolean} True if any CLI command is present
 */
export function hasCliCommand(args) {
    return args.some(arg => CLI_COMMANDS.includes(arg));
}

/**
 * Check if arguments contain a CLI-only command (non-GUI)
 * @param {string[]} args - Command line arguments
 * @returns {boolean} True if any CLI-only command is present
 */
export function hasCliOnlyCommand(args) {
    return args.some(arg => CLI_ONLY_COMMANDS.includes(arg));
}

/**
 * Check if arguments contain a GUI command
 * @param {string[]} args - Command line arguments
 * @returns {boolean} True if any GUI command is present
 */
export function hasGuiCommand(args) {
    return args.some(arg => GUI_COMMANDS.includes(arg));
}

/**
 * Filter and clean CLI arguments
 * Removes macOS-specific flags like -psn_X_XXXXX
 * @param {string[]} argv - Raw process.argv
 * @returns {string[]} Cleaned arguments
 */
export function getCleanCliArgs(argv) {
    return argv.slice(2).filter(arg => !arg.startsWith('-psn'));
}

