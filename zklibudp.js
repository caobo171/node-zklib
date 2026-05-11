/**
 * UDP transport for node-zklib.
 *
 * Parallels zklibtcp.js but talks to the device over dgram. Owns its own
 * sessionId/replyId handshake state and reassembles chunked data replies.
 * UDP firmwares are typically older and use compact (28-byte user, 16-byte
 * attendance) record layouts — see PACKET_SIZES.
 */
const dgram = require('dgram');
const timeParser = require('./timeParser');

const {
  createUDPHeader,
  decodeUserData28,
  decodeRecordData16,
  decodeRecordRealTimeLog18,
  decodeUDPHeader,
  exportErrorMessage,
  isEventPacketUDP,
} = require('./utils')

const {
  MAX_CHUNK,
  REQUEST_DATA,
  COMMANDS,
  PROTOCOL,
  PACKET_SIZES,
  FREE_SIZES_OFFSETS,
  TIMEOUTS,
} = require('./constants')

const { log } = require('./helpers/errorLog')
const { ZKError } = require('./zkerror')

class ZKLibUDP {
  constructor(ip, port, timeout, inport, comm_key) {
    this.ip = ip
    this.port = port
    this.timeout = timeout
    this.socket = null
    this.sessionId = null
    this.replyId = 0
    this.inport = inport
    this.comm_key = comm_key
    // Mirrors zklibtcp's gate — set true after a successful CMD_CONNECT.
    this.is_connect = false
  }

  createSocket(cbError, cbClose) {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');
      this.socket.setMaxListeners(Infinity)
      this.socket.once('error', err => {
        reject(err)
        cbError && cbError(err)
      })

      this.socket.on('close', (err) => {
        this.socket = null;
        cbClose && cbClose('udp')
      })

      this.socket.once('listening', () => {
        resolve(this.socket)
      })
      try {
        this.socket.bind(this.inport)
      } catch (err) {
      }

    })
  }

  connect() {
    return new Promise(async (resolve, reject) => {
      try {
        const reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '')
        if (reply) {
          this.is_connect = true
          resolve(true)
        } else {
          reject(new Error('NO_REPLY_ON_CMD_CONNECT'))
        }
      } catch (err) {
        reject(err)
      }
    })
  }


  closeSocket() {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners('message')
      this.socket.close(() => {
        clearTimeout(timer)
        resolve(true)
      })

      /**
       * When socket isn't connected so this.socket.end will never resolve
       * we use settimeout for handling this case
       */
      const timer = setTimeout(() => {
        resolve(true)
      }, TIMEOUTS.CLOSE_SOCKET)
    })
  }

  writeMessage(msg, connect) {
    return new Promise((resolve, reject) => {
      let sendTimeoutId;
      this.socket.once('message', (data) => {
        sendTimeoutId && clearTimeout(sendTimeoutId)
        resolve(data)
      })

      this.socket.send(msg, 0, msg.length, this.port, this.ip, (err) => {
        if (err) {
          reject(err)
        }
        if (this.timeout) {
          sendTimeoutId = setTimeout(() => {
            clearTimeout(sendTimeoutId)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? TIMEOUTS.CONNECT : this.timeout)
        }
      })
    })
  }

  requestData(msg) {
    return new Promise((resolve, reject) => {
      let sendTimeoutId
      const internalCallback = (data) => {
        sendTimeoutId && clearTimeout(sendTimeoutId)
        this.socket.removeListener('message', handleOnData)
        resolve(data)
      }

      const handleOnData = (data) => {
        if (isEventPacketUDP(data)) return;
        clearTimeout(sendTimeoutId)
        sendTimeoutId = setTimeout(() => {
          reject(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA'))
        }, this.timeout)

        if (data.length >= PROTOCOL.UDP_MIN_DATA_REPLY) {
          internalCallback(data)
        }

      }

      this.socket.on('message', handleOnData)

      this.socket.send(msg, 0, msg.length, this.port, this.ip, (err) => {
        if (err) {
          reject(err)
        }
        sendTimeoutId = setTimeout(() => {
          reject(Error('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA'))
        }, this.timeout)

      })
    })

  }

  /**
  * 
  * @param {*} command 
  * @param {*} data 
  * 
  * 
  * reject error when command fail and resolve data when success
  */
  executeCmd(command, data) {
    return new Promise(async (resolve, reject) => {
      try {
        // Mirror TCP behavior: reject pre-connect calls. CMD_CONNECT/CMD_AUTH bypass the gate.
        if (![COMMANDS.CMD_CONNECT, COMMANDS.CMD_AUTH].includes(command) && !this.is_connect) {
          return reject(new ZKError(new Error('NOT_CONNECTED'), 'executeCmd', this.ip))
        }

        if (command === COMMANDS.CMD_CONNECT) {
          this.sessionId = 0
          this.replyId = 0
        } else {
          this.replyId++
        }


        const buf = createUDPHeader(command, this.sessionId, this.replyId, data)
        const reply = await this.writeMessage(buf, command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT)

        // Only parse the session id when the reply is at least one full ZK header.
        if (reply && reply.length >= PROTOCOL.ZK_HEADER_LEN) {
          if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = reply.readUInt16LE(4);
          }
        }
        resolve(reply)
      } catch (err) {
        reject(err)
      }
    })
  }


  sendChunkRequest(start, size) {
    this.replyId++;
    const reqData = Buffer.alloc(8)
    reqData.writeUInt32LE(start, 0)
    reqData.writeUInt32LE(size, 4)
    const buf = createUDPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData)

    this.socket.send(buf, 0, buf.length, this.port, this.ip, (err) => {
      if (err) {
        if (err) {
          log(`[UDP][SEND_CHUNK_REQUEST]` + err.toString())
        }
      }
    })
  }



  /**
   * 
   * @param {*} reqData - indicate the type of data that need to receive ( user or attLog)
   * @param {*} cb - callback is triggered when receiving packets
   * 
   * readWithBuffer will reject error if it'wrong when starting request data 
   * readWithBuffer will return { data: replyData , err: Error } when receiving requested data
   */
  readWithBuffer(reqData, cb = null) {
    return new Promise(async (resolve, reject) => {
      this.replyId++;
      const buf = createUDPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData)


      let reply = null
      try {
        reply = await this.requestData(buf)
      } catch (err) {
        reject(err)
      }

      const header = decodeUDPHeader(reply.subarray(0, PROTOCOL.ZK_HEADER_LEN))

      switch (header.commandId) {
        case COMMANDS.CMD_DATA: {
          resolve({ data: reply.subarray(PROTOCOL.ZK_HEADER_LEN), mode: 8, err: null })
          break;
        }
        case COMMANDS.CMD_ACK_OK:
        case COMMANDS.CMD_PREPARE_DATA: {
          // this case show that data is prepared => send command to get these data 
          // reply variable includes information about the size of following data 
          const recvData = reply.subarray(PROTOCOL.ZK_HEADER_LEN)
          const size = recvData.readUIntLE(1, 4)

          // We need to split the data to many chunks to receive , because it's to large
          // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
          let remain = size % MAX_CHUNK
          let numberChunks = Math.round(size - remain) / MAX_CHUNK

          let totalBuffer = Buffer.from([])


          const timeout = TIMEOUTS.CHUNK_UDP
          let timer = setTimeout(() => {
            internalCallback(totalBuffer, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)


          const internalCallback = (replyData, err = null) => {
            this.socket.removeListener('message', handleOnData)
            timer && clearTimeout(timer)
            if (err) {
              resolve({ err, data: replyData })
            } else {
              resolve({ err: null, data: replyData })
            }
          }


          const handleOnData = (reply) => {
            if (isEventPacketUDP(reply)) return;
            clearTimeout(timer)
            timer = setTimeout(() => {
              const pct = Math.round((1 - totalBuffer.length / size) * 100)
              internalCallback(totalBuffer, new Error(`TIMEOUT — ${pct}% REMAIN`))
            }, timeout)
            const header = decodeUDPHeader(reply)

            switch (header.commandId) {
              case COMMANDS.CMD_PREPARE_DATA: {
                break;
              }
              case COMMANDS.CMD_DATA: {
                totalBuffer = Buffer.concat([totalBuffer, reply.subarray(PROTOCOL.ZK_HEADER_LEN)])
                cb && cb(totalBuffer.length, size)
                break;
              }
              case COMMANDS.CMD_ACK_OK: {
                if (totalBuffer.length === size) {
                  internalCallback(totalBuffer)
                }
                break;
              }
              default: {
                internalCallback([], new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)))
              }
            }
          }

          this.socket.on('message', handleOnData);

          for (let i = 0; i <= numberChunks; i++) {
            if (i === numberChunks) {
              this.sendChunkRequest(numberChunks * MAX_CHUNK, remain)
            } else {
              this.sendChunkRequest(i * MAX_CHUNK, MAX_CHUNK)
            }
          }

          break;
        }
        default: {
          reject(new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)))
        }
      }
    })
  }


  async getUsers() {

    // Free Buffer Data to request Data
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }


    let data = null
    try {
      data = await this.readWithBuffer(REQUEST_DATA.GET_USERS)
    } catch (err) {
      return Promise.reject(err)
    }

    // Free Buffer Data after requesting data
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    // UDP firmwares use compact 28-byte user records (no password/cardno).
    const recordSize = PACKET_SIZES.USER_UDP
    let userData = data.data.subarray(4)
    const users = []

    while (userData.length >= recordSize) {
      users.push(decodeUserData28(userData.subarray(0, recordSize)))
      userData = userData.subarray(recordSize)
    }

    return { data: users, err: data.err }

  }


  /**
   * 
   * @param {*} ip 
   * @param {*} callbackInProcess  
   *  reject error when starting request data
   *  return { data: records, err: Error } when receiving requested data
   */


  async getAttendances(callbackInProcess = () => { }) {
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    let data = null
    try{
      data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS, callbackInProcess)
    }catch(err){
      return Promise.reject(err)
    }
    
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    // `data.mode` is set when the device returned a small (CMD_DATA inline) reply
    // — those use half-width 8-byte records. Otherwise the records are 16 bytes.
    const recordSize = data.mode ? PACKET_SIZES.ATT_LOG_UDP_COMPACT : PACKET_SIZES.ATT_LOG_UDP_FULL
    let recordData = data.data.subarray(4)
    const records = []

    while (recordData.length >= recordSize) {
      const record = decodeRecordData16(recordData.subarray(0, recordSize))
      records.push({ ...record, ip: this.ip })
      recordData = recordData.subarray(recordSize)
    }

    return { data: records, err: data.err }

  }



  async freeData() {
    return await this.executeCmd(COMMANDS.CMD_FREE_DATA, '')
  }

  async getTime() {
		const time = await this.executeCmd(COMMANDS.CMD_GET_TIME, '');
		return timeParser.decode(time.readUInt32LE(8));
	}

  async getInfo() {
    const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '')
    try {
      return {
        userCounts: data.readUIntLE(FREE_SIZES_OFFSETS.USER_COUNT, 4),
        logCounts: data.readUIntLE(FREE_SIZES_OFFSETS.LOG_COUNT, 4),
        logCapacity: data.readUIntLE(FREE_SIZES_OFFSETS.LOG_CAPACITY, 4),
      }
    } catch (err) {
      return Promise.reject(err)
    }
  }

  async clearAttendanceLog (){
    return await this.executeCmd(COMMANDS.CMD_CLEAR_ATTLOG, '')
  }


  async disableDevice() {
    return await this.executeCmd(COMMANDS.CMD_DISABLEDEVICE, REQUEST_DATA.DISABLE_DEVICE)
  }

  async enableDevice() {
    return await this.executeCmd(COMMANDS.CMD_ENABLEDEVICE, '')
  }

  async disconnect() {
    try {
      await this.executeCmd(COMMANDS.CMD_EXIT, '')
    } catch (err) {
      // CMD_EXIT errors are non-fatal — we still want to close the socket.
    }
    this.is_connect = false
    return await this.closeSocket()
  }



  async getRealTimeLogs(cb = () => { }) {
    this.replyId++;
    const buf = createUDPHeader(COMMANDS.CMD_REG_EVENT, this.sessionId, this.replyId, REQUEST_DATA.GET_REAL_TIME_EVENT)

    this.socket.send(buf, 0, buf.length, this.port, this.ip, (err) => {

    })

    this.socket.listenerCount('message') < 2 && this.socket.on('message', (data) => {

      if (!isEventPacketUDP(data)) return;
      if (data.length === PACKET_SIZES.REALTIME_LOG_UDP) {
        cb(decodeRecordRealTimeLog18(data))
      }
    })

  }
}




module.exports = ZKLibUDP
