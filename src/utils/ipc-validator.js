const path = require('path');
const { app } = require('electron');

class IPCValidator {
  static schemas = {
    'start-scan': {
      storeMappingFile: { 
        type: 'string', 
        required: true, 
        maxLength: 500,
        validate: (value) => IPCValidator.validateFilePath(value, ['.csv'])
      },
      itemListFile: { 
        type: 'string', 
        required: false, 
        maxLength: 500,
        validate: (value) => !value || IPCValidator.validateFilePath(value, ['.csv', '.xlsx'])
      },
      settings: {
        type: 'object',
        required: true,
        properties: {
          delayBetweenItems: { type: 'number', min: 500, max: 60000 },
          delayBetweenStores: { type: 'number', min: 1000, max: 120000 },
          pageTimeout: { type: 'number', min: 5000, max: 300000 },
          maxRetries: { type: 'number', min: 1, max: 10 },
          maxConcurrentAgents: { type: 'number', min: 1, max: 31 },
          headless: { type: 'boolean' }
        }
      }
    },
    'export-results': {
      exportPath: {
        type: 'string',
        required: true,
        maxLength: 500,
        validate: (value) => IPCValidator.validateExportPath(value)
      }
    },
    'save-config': {
      config: {
        type: 'object',
        required: true
      }
    }
  };

  static validate(channel, data) {
    const schema = this.schemas[channel];
    if (!schema) {
      throw new Error(`No validation schema for channel: ${channel}`);
    }

    return this.validateObject(data, schema);
  }

  static validateObject(obj, schema) {
    const validated = {};

    for (const [key, rules] of Object.entries(schema)) {
      const value = obj[key];

      // Check required
      if (rules.required && (value === undefined || value === null)) {
        throw new Error(`Missing required field: ${key}`);
      }

      // Skip if optional and not provided
      if (!rules.required && (value === undefined || value === null)) {
        continue;
      }

      // Type check
      if (rules.type === 'object' && typeof value !== 'object') {
        throw new Error(`Field ${key} must be an object`);
      } else if (rules.type === 'string' && typeof value !== 'string') {
        throw new Error(`Field ${key} must be a string`);
      } else if (rules.type === 'number' && typeof value !== 'number') {
        throw new Error(`Field ${key} must be a number`);
      } else if (rules.type === 'boolean' && typeof value !== 'boolean') {
        throw new Error(`Field ${key} must be a boolean`);
      }

      // String validations
      if (rules.type === 'string') {
        if (rules.maxLength && value.length > rules.maxLength) {
          throw new Error(`Field ${key} exceeds maximum length of ${rules.maxLength}`);
        }
      }

      // Number validations
      if (rules.type === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          throw new Error(`Field ${key} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          throw new Error(`Field ${key} must be at most ${rules.max}`);
        }
      }

      // Object validations (recursive)
      if (rules.type === 'object' && rules.properties) {
        validated[key] = this.validateObject(value, rules.properties);
        continue;
      }

      // Custom validation
      if (rules.validate) {
        const validationResult = rules.validate(value);
        if (validationResult !== true && validationResult !== undefined) {
          throw new Error(`Validation failed for ${key}: ${validationResult}`);
        }
      }

      validated[key] = value;
    }

    return validated;
  }

  static validateFilePath(filePath, allowedExtensions) {
    // Normalize and resolve path
    const normalized = path.normalize(filePath);
    const resolved = path.resolve(normalized);

    // Check extension
    const ext = path.extname(resolved).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`);
    }

    // Prevent path traversal
    if (normalized.includes('..')) {
      throw new Error('Path traversal detected');
    }

    // Restrict to allowed directories
    const allowedDirs = [
      app.getPath('userData'),
      app.getPath('documents'),
      app.getPath('downloads'),
      app.getPath('desktop')
    ];

    const isAllowed = allowedDirs.some(dir => resolved.startsWith(path.resolve(dir)));
    if (!isAllowed) {
      throw new Error('File must be in an allowed directory (Documents, Downloads, Desktop, or App Data)');
    }

    return true;
  }

  static validateExportPath(exportPath) {
    const normalized = path.normalize(exportPath);
    const resolved = path.resolve(normalized);

    // Check extension
    const ext = path.extname(resolved).toLowerCase();
    if (ext !== '.xlsx') {
      throw new Error('Export file must have .xlsx extension');
    }

    // Prevent path traversal
    if (normalized.includes('..')) {
      throw new Error('Path traversal detected');
    }

    // Restrict to safe directories
    const allowedDirs = [
      app.getPath('documents'),
      app.getPath('downloads'),
      app.getPath('desktop')
    ];

    const isAllowed = allowedDirs.some(dir => resolved.startsWith(path.resolve(dir)));
    if (!isAllowed) {
      throw new Error('Export file must be in Documents, Downloads, or Desktop');
    }

    return true;
  }

  static sanitizeASIN(asin) {
    // ASINs are 10 alphanumeric characters
    if (typeof asin !== 'string') {
      throw new Error('ASIN must be a string');
    }

    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      throw new Error('Invalid ASIN format (must be 10 alphanumeric characters)');
    }

    return asin;
  }
}

module.exports = IPCValidator;