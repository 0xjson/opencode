import { TeamInbox } from "./packages/opencode/src/team/inbox";

console.log("Testing team messaging system...\n");

// Test message from ui-specialist to tech-lead
try {
  await TeamInbox.sendMessage(
    "aquilonix",
    "tech-lead",
    "ui-specialist",
    "📋 I've claimed the UI landing page task (01KM9UI123TEST456UI789SPECIAL). Starting work on the component design with responsive layout and animations.",
    "message"
  );
  console.log("✅ Message sent: ui-specialist → tech-lead");
} catch (e) {
  console.log("❌ Failed to send message to tech-lead:", e);
}

// Test message from ui-specialist to frontend-dev
try {
  await TeamInbox.sendMessage(
    "aquilonix",
    "frontend-dev",
    "ui-specialist",
    "🎨 Working on the landing page components. I'll create reusable Hero, FeatureCard, and CTAButton components. Let me know if you need specific props or integration points!",
    "message"
  );
  console.log("✅ Message sent: ui-specialist → frontend-dev");
} catch (e) {
  console.log("❌ Failed to send message to frontend-dev:", e);
}

// Response from tech-lead
try {
  await TeamInbox.sendMessage(
    "aquilonix",
    "ui-specialist",
    "tech-lead",
    "👍 Great! Please ensure accessibility (aria-labels) and test on mobile. Update me on progress.",
    "message"
  );
  console.log("✅ Message sent: tech-lead → ui-specialist");
} catch (e) {
  console.log("❌ Failed to send message to ui-specialist:", e);
}

// Response from frontend-dev
try {
  await TeamInbox.sendMessage(
    "aquilonix",
    "ui-specialist",
    "frontend-dev",
    "Perfect! For integration, I'll need the components to accept 'onClick' handlers and 'className' props. Looking forward to integrating these!",
    "message"
  );
  console.log("✅ Message sent: frontend-dev → ui-specialist");
} catch (e) {
  console.log("❌ Failed to send message to ui-specialist:", e);
}

console.log("\n📨 Test messaging complete!");
