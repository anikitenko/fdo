const { test, expect, _electron: electron } = require('@playwright/test');

let electronApp;
let mainWindow;
let editorWindow;

test.beforeAll(async () => {
  try {
    electronApp = await electron.launch({ args: ['.'] });
    mainWindow = await electronApp.firstWindow();
    
    // Attach dialog handler to avoid hangs
    const acceptAllDialogs = async (dialog) => { 
      try { 
        await dialog.accept(); 
      } catch (_) {} 
    };
    mainWindow.on('dialog', acceptAllDialogs);
    electronApp.on('window', (page) => {
      page.on('dialog', acceptAllDialogs);
    });
    
    // Wait for the main window to be ready
    await mainWindow.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
    // Create a plugin and open the editor
    await mainWindow.click('button:has-text("Plugins Activated")', { timeout: 10000 });
    await mainWindow.click('text=Create plugin', { timeout: 5000 });
    const randomName = 'test-ai-plugin-' + Math.random().toString(36).substring(2, 8);
    await mainWindow.fill('#plugin-name', randomName, { timeout: 5000 });
    
    const [newEditorWindow] = await Promise.all([
      electronApp.waitForEvent('window'),
      mainWindow.click('text=Open editor', { timeout: 5000 })
    ]);
    editorWindow = newEditorWindow;
    
    // Set up dialog handler for editor window
    editorWindow.on('dialog', acceptAllDialogs);
    
    // Wait for editor to be ready
    await editorWindow.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await editorWindow.waitForTimeout(2000);
  } catch (error) {
    console.error('Error in beforeAll:', error);
    throw error;
  }
}, 90000);

test.afterAll(async () => {
  if (electronApp) {
    try {
      const windows = electronApp.windows();
      for (const win of windows) {
        try {
          await win.close();
        } catch (e) {
          console.error('Error closing window:', e);
        }
      }
      await electronApp.close();
    } catch (e) {
      console.error('Error in afterAll:', e);
    }
  }
}, 60000);

test.describe('AI Coding Agent Tab', () => {
  test('should display AI Coding Agent tab in the bottom panel', async () => {
    // Check if the AI Coding Agent tab exists
    const aiAgentTab = editorWindow.locator('text=AI Coding Agent');
    await expect(aiAgentTab).toBeVisible({ timeout: 10000 });
  });

  test('should switch to AI Coding Agent tab when clicked', async () => {
    // Click on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    
    // Wait for the panel to be visible
    await editorWindow.waitForTimeout(500);
    
    // Check if the AI Coding Agent panel header is visible
    const panelHeader = editorWindow.locator('text=AI Coding Assistant');
    await expect(panelHeader).toBeVisible({ timeout: 5000 });
  });

  test('should display action dropdown in AI Coding Agent panel', async () => {
    // Ensure we're on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(500);
    
    // Check if the action dropdown exists
    const actionSelect = editorWindow.locator('#action-select');
    await expect(actionSelect).toBeVisible({ timeout: 5000 });
    
    // Verify default value is "generate"
    const selectedValue = await actionSelect.inputValue();
    expect(selectedValue).toBe('generate');
  });

  test('should display prompt textarea in AI Coding Agent panel', async () => {
    // Ensure we're on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(500);
    
    // Check if the prompt textarea exists
    const promptInput = editorWindow.locator('#prompt-input');
    await expect(promptInput).toBeVisible({ timeout: 5000 });
  });

  test('should display submit button in AI Coding Agent panel', async () => {
    // Ensure we're on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(500);
    
    // Check if the submit button exists
    const submitButton = editorWindow.locator('button:has-text("Submit")');
    await expect(submitButton).toBeVisible({ timeout: 5000 });
    
    // Button should be disabled when prompt is empty
    const isDisabled = await submitButton.isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('should enable submit button when prompt is filled', async () => {
    // Ensure we're on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(500);
    
    // Fill in the prompt
    const promptInput = editorWindow.locator('#prompt-input');
    await promptInput.fill('Create a function that adds two numbers');
    
    // Check if submit button is now enabled
    const submitButton = editorWindow.locator('button:has-text("Submit")');
    await editorWindow.waitForTimeout(300);
    const isDisabled = await submitButton.isDisabled();
    expect(isDisabled).toBe(false);
  });

  test('should change action dropdown options', async () => {
    // Ensure we're on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(500);
    
    // Get the action dropdown
    const actionSelect = editorWindow.locator('#action-select');
    
    // Change to "Edit Code"
    await actionSelect.selectOption('edit');
    let selectedValue = await actionSelect.inputValue();
    expect(selectedValue).toBe('edit');
    
    // Change to "Explain Code"
    await actionSelect.selectOption('explain');
    selectedValue = await actionSelect.inputValue();
    expect(selectedValue).toBe('explain');
    
    // Change to "Fix Code"
    await actionSelect.selectOption('fix');
    selectedValue = await actionSelect.inputValue();
    expect(selectedValue).toBe('fix');
    
    // Change back to "Generate Code"
    await actionSelect.selectOption('generate');
    selectedValue = await actionSelect.inputValue();
    expect(selectedValue).toBe('generate');
  });

  test('should display NonIdealState when no response', async () => {
    // Ensure we're on the AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(500);
    
    // Check if NonIdealState is displayed
    const nonIdealState = editorWindow.locator('text=Select an action and provide a prompt');
    await expect(nonIdealState).toBeVisible({ timeout: 5000 });
  });

  test('should switch between tabs (Problems, Output, AI Coding Agent)', async () => {
    // Click on Problems tab
    await editorWindow.click('text=Problems');
    await editorWindow.waitForTimeout(300);
    let activeTab = await editorWindow.locator('[role="tab"][aria-selected="true"]').textContent();
    expect(activeTab).toContain('Problems');
    
    // Click on Output tab
    await editorWindow.click('[role="tab"]:has-text("Output")');
    await editorWindow.waitForTimeout(300);
    activeTab = await editorWindow.locator('[role="tab"][aria-selected="true"]').textContent();
    expect(activeTab).toContain('Output');
    
    // Click on AI Coding Agent tab
    await editorWindow.click('text=AI Coding Agent');
    await editorWindow.waitForTimeout(300);
    activeTab = await editorWindow.locator('[role="tab"][aria-selected="true"]').textContent();
    expect(activeTab).toContain('AI Coding Agent');
  });
});
