// Host-owned recipes only. Adding a recipe here makes it available to every
// process scope that names the executable; capabilities never grant installation.
const guide = (label, url, commands = {}) => ({label, url, commands});
export const TOOL_INSTALL_CATALOG = Object.freeze({
    az: guide('Azure CLI', 'https://learn.microsoft.com/cli/azure/install-azure-cli/', {darwin: 'brew install azure-cli', win32: 'winget install --exact --id Microsoft.AzureCLI'}),
    aws: guide('AWS CLI', 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html'),
    gcloud: guide('Google Cloud CLI', 'https://cloud.google.com/sdk/docs/install'),
    git: guide('Git', 'https://git-scm.com/downloads'),
    gh: guide('GitHub CLI', 'https://github.com/cli/cli#installation'),
    glab: guide('GitLab CLI', 'https://docs.gitlab.com/editor_extensions/gitlab_cli/'),
    docker: guide('Docker', 'https://docs.docker.com/get-started/get-docker/'),
    podman: guide('Podman', 'https://podman.io/docs/installation'),
    kubectl: guide('kubectl', 'https://kubernetes.io/docs/tasks/tools/'),
    helm: guide('Helm', 'https://helm.sh/docs/intro/install/'),
    kustomize: guide('Kustomize', 'https://kubectl.docs.kubernetes.io/installation/kustomize/'),
    terraform: guide('Terraform', 'https://developer.hashicorp.com/terraform/install'),
    vault: guide('Vault', 'https://developer.hashicorp.com/vault/install'),
    nomad: guide('Nomad', 'https://developer.hashicorp.com/nomad/install'),
    ansible: guide('Ansible', 'https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html'),
    brew: guide('Homebrew', 'https://docs.brew.sh/Installation'),
    node: guide('Node.js', 'https://nodejs.org/en/download'),
    npm: guide('npm (Node.js)', 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm'),
    npx: guide('npx (Node.js)', 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm'),
    pnpm: guide('pnpm', 'https://pnpm.io/installation'),
    yarn: guide('Yarn', 'https://yarnpkg.com/getting-started/install'),
    pip: guide('pip', 'https://pip.pypa.io/en/stable/installation/'),
    pip3: guide('pip3', 'https://pip.pypa.io/en/stable/installation/'),
    uv: guide('uv', 'https://docs.astral.sh/uv/getting-started/installation/'),
    python: guide('Python', 'https://www.python.org/downloads/'),
    python3: guide('Python 3', 'https://www.python.org/downloads/'),
    cmake: guide('CMake', 'https://cmake.org/download/'),
    ctest: guide('CTest (CMake)', 'https://cmake.org/download/'),
    ninja: guide('Ninja', 'https://ninja-build.org/'),
    gradle: guide('Gradle', 'https://docs.gradle.org/current/userguide/installation.html'),
    mvn: guide('Apache Maven', 'https://maven.apache.org/install.html'),
    'ansible-playbook': guide('Ansible playbook', 'https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html'),
    curl: guide('curl', 'https://curl.se/download.html'),
    wget: guide('GNU Wget', 'https://www.gnu.org/software/wget/'),
    '7z': guide('7-Zip', 'https://www.7-zip.org/download.html'),
    choco: guide('Chocolatey', 'https://chocolatey.org/install'),
    winget: guide('WinGet', 'https://learn.microsoft.com/windows/package-manager/winget/'),
    make: guide('Make', 'https://www.gnu.org/software/make/'),
    just: guide('Just', 'https://just.systems/man/en/packages.html'),
    task: guide('Task', 'https://taskfile.dev/docs/installation'),
});
export function installGuide(name, platform) {
    const entry = TOOL_INSTALL_CATALOG[name];
    return entry ? {label: entry.label, url: entry.url, command: entry.commands[platform] || ''} : null;
}
export function x11InstallGuide(platform) {
    if (platform === 'darwin') return {label: 'XQuartz / X11', url: 'https://www.xquartz.org/releases/', command: 'brew install --cask xquartz', note: 'Install XQuartz, log out and back in if requested, then start XQuartz and restart FDO from the display session. Installation alone does not make a display reachable. Recheck Local X11 support in Credentials & SSH.'};
    if (platform === 'linux') return {label: 'Local X11 / xauth', url: 'https://www.x.org/wiki/', command: '', note: 'Use your distribution’s package manager to install xauth and an Xorg or Xwayland desktop session. Run FDO in that authenticated session with DISPLAY available. Wayland alone does not provide X11. Recheck Local X11 support in Credentials & SSH.'};
    return {label: 'Local X11', url: '', command: '', note: 'Local X11 forwarding is not supported by FDO on Windows yet. Installing a Windows X server or WSLg does not enable the current host adapter. SSH terminals remain available without X11.'};
}
