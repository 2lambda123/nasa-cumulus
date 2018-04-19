const local = require('./local-helpers');
const messageSource = require('./message-source');
const log = require('./log');

/**
 * Creates a collection input message for the given id by reading from local collections.yml
 * @param {string} id - The collection id in collections.yml
 * @return - The input message
 */
exports.collectionMessageInput = (id, task) => {
  const message = local.collectionMessageInput(id)();
  message.ingest_meta.task = task;
  return message;
};

/**
 * An MessageSource instance suitable for tests, which mocks
 * MessageSource methods typically read from AWS calls
 */
class TestSource extends messageSource.MessageSource {
  /**
   * @param {object} message - The incoming message data
   */
  constructor(message) {
    super();
    this.messageData = message;
    if (message && message.meta) {
      this.key = message.meta.key;
    }
  }

  /**
   * @return - A promise resolving to null
   */
  getMessageScopedJson() {
    return Promise.resolve(null);
  }

  /**
   * @return The 'state' field of the message
   */
  loadState() {
    if (!this.messageData || !this.messageData.state) {
      return undefined;
    }
    return Object.assign({}, this.messageData && this.messageData.state);
  }

  /**
   * Saves the state for reading by tests
   * @param {string} taskName - Not used by this method
   * @param {string} state - The state to save
   */
  saveState(taskName, state) {
    if (this.messageData) {
      this.messageData.stateOut = state;
    }
  }

  /**
   * @return - true
   */
  static isSourceFor() {
    return true;
  }
}

/**
 * Creates and runs ingest for an instance of the given Task class with the given input
 * @param {class} TaskClass - The Task class to create/run
 * @param {object} input - The input message to run the Task with
 * @return - A tuple containing the callback values [error, data] invoked by the task
 */
exports.run = async (TaskClass, input) => {
  messageSource.messageSources.unshift(TestSource);
  try {
    let data;
    let error;
    await TaskClass.handler(input, {}, (e, d) => {
      data = d;
      error = e;
    });
    return [error, data];
  }
  finally {
    messageSource.messageSources.shift();
  }
};
