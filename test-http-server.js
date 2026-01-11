/**
 * HTTP SSE 模式测试脚本
 * 用于验证 NovelAI MCP Server 的 HTTP 功能
 */

import fetch from 'node-fetch';
import { EventSource } from 'eventsource';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function testHealthCheck() {
  console.log('🔍 Testing health check...');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    console.log('✅ Health check passed:', data);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function testSSEConnection() {
  console.log('\n📡 Testing SSE connection...');

  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(`${SERVER_URL}/sse`);
    let timeout;

    eventSource.onopen = () => {
      console.log('✅ SSE connection established');
      clearTimeout(timeout);
      eventSource.close();
      resolve(true);
    };

    eventSource.onerror = (error) => {
      console.error('❌ SSE connection error:', error);
      clearTimeout(timeout);
      eventSource.close();
      reject(error);
    };

    // 5秒超时
    timeout = setTimeout(() => {
      console.error('❌ SSE connection timeout');
      eventSource.close();
      reject(new Error('Connection timeout'));
    }, 5000);
  });
}

async function testMCPProtocol() {
  console.log('\n🔧 Testing MCP protocol...');
  console.log('⚠️  Note: This requires a proper MCP client implementation');
  console.log('   For now, we just verify the endpoint is accessible');

  try {
    // 简单的 POST 测试（实际 MCP 协议更复杂）
    const response = await fetch(`${SERVER_URL}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    console.log('✅ Message endpoint accessible, status:', response.status);
    return true;
  } catch (error) {
    console.error('❌ Message endpoint test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting NovelAI MCP HTTP Server Tests\n');
  console.log(`Server URL: ${SERVER_URL}\n`);
  console.log('─'.repeat(50));

  let allPassed = true;

  // Test 1: Health Check
  if (!await testHealthCheck()) {
    allPassed = false;
    console.log('\n⚠️  Please make sure the server is running:');
    console.log('   npm run start:http');
    return;
  }

  // Test 2: SSE Connection
  try {
    await testSSEConnection();
  } catch (error) {
    allPassed = false;
  }

  // Test 3: MCP Protocol
  if (!await testMCPProtocol()) {
    allPassed = false;
  }

  console.log('\n' + '─'.repeat(50));
  if (allPassed) {
    console.log('✅ All tests passed!');
    console.log('\n💡 Next steps:');
    console.log('   1. Configure your MCP client to use: ' + SERVER_URL + '/sse');
    console.log('   2. Use the generate_image tool to create images');
  } else {
    console.log('❌ Some tests failed. Please check the errors above.');
  }
}

// 需要安装 eventsource
console.log('⚠️  This test requires the "eventsource" package.');
console.log('   Install it with: npm install eventsource\n');

// 检查是否安装了 eventsource
try {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('\n❌ Missing dependency: eventsource');
    console.error('   Please run: npm install eventsource');
    process.exit(1);
  }
  throw error;
}
