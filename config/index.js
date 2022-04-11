const config = require('getconfig')

config.get = (objectPath, defaultValue = null) => {
  const path = objectPath.split('.')
  let current = config

  if (objectPath === '') {
    return current
  }

  while (path.length > 0) {
    if (!current[path[0]] && current[path[0]] !== false) {
      return defaultValue
    }
    current = current[path.shift()]
  }

  return current
}

config.clone = (objectPath, defaultValue = null) => {
  if (!config.has(objectPath)) {
    return defaultValue
  }

  return JSON.parse(JSON.stringify(config.get(objectPath)))
}

config.has = (objectPath) => {
  const path = objectPath.split('.')
  let current = config

  if (objectPath === '') {
    return true
  }

  while (path.length > 0) {
    if (typeof current !== 'object' || current === null) {
      return false
    }
    if (!Object.prototype.hasOwnProperty.call(current, path[0])) {
      return false
    }
    current = current[path.shift()]
  }

  return true
}

module.exports = config
