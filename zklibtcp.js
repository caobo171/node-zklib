/**
 * TCP transport for node-zklib.
 *
 * Implements the same operation surface as zklibudp.js but over a streamed
 * net.Socket connection. Owns sessionId/replyId handshake state and chunks
 * large data replies into MAX_CHUNK-sized requests. All operations require a
 * prior successful connect(); methods called before connect reject through
 * the executeCmd gate.
 */
const net = require('net')
const timeParser = require('./timeParser');

const {
  MAX_CHUNK,
  COMMANDS,
  REQUEST_DATA,
  PROTOCOL,
  PACKET_SIZES,
  FREE_SIZES_OFFSETS,
  TIMEOUTS,
} = require('./constants')
const {
  createTCPHeader,
  exportErrorMessage,
  removeTcpHeader,
  decodeUserData72,
  decodeRecordData40,
  decodeRecordRealTimeLog52,
  isEventPacketTCP,
  decodeTCPHeader,
  makeCommKey,
} = require('./utils')

const { log } = require('./helpers/errorLog');
const { ZKError } = require('./zkerror');

class ZKLibTCP {
  is_connect = false;

  constructor(ip, port = 4370, timeout = 10000, comm_code = undefined, encoding = 'UTF-8', maxChunk = MAX_CHUNK) {
    this.ip = ip
    this.port = port
    this.timeout = timeout
    this.sessionId = null
    this.replyId = 0
    this.socket = null
    this.comm_code = comm_code
    this.encoding = encoding
    // Size in bytes each bulk download is sliced into. A smaller value makes
    // each chunk request individually more robust over slow/high-latency links
    // where large chunks stall partway through the download.
    this.maxChunk = maxChunk || MAX_CHUNK
  }


  createSocket(cbError, cbClose) {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()

      this.socket.once('error', err => {
        reject(err)
        cbError && cbError(err)
      })

      this.socket.once('connect', () => {
        resolve(this.socket)
      })

      this.socket.once('close', (err) => {
        this.socket = null;
        cbClose && cbClose('tcp')
      })


      if (this.timeout) {
        this.socket.setTimeout(this.timeout)
      }

      this.socket.connect(this.port, this.ip)
    })
  }


  connect() {
    return new Promise(async (resolve, reject) => {
      try {
        let reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '')

        if (reply.readUInt16LE(0) === COMMANDS.CMD_ACK_OK) {
          resolve(true)
        }
        if (reply.readUInt16LE(0) === COMMANDS.CMD_ACK_UNAUTH) {
          const hashedCommkey = makeCommKey(this.comm_code, this.sessionId)
          reply = await this.executeCmd(COMMANDS.CMD_AUTH, hashedCommkey)
          
          if (reply.readUInt16LE(0) === COMMANDS.CMD_ACK_OK) {
            resolve(true)
          } else {
            reject(new Error('AUTH_FAILED: 0x' + reply.readUInt16LE(0).toString(16)))
          }
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
      this.socket.removeAllListeners('data')
      this.socket.end(() => {
        clearTimeout(timer)
        resolve(true)
      })
      /**
       * When socket isn't connected so this.socket.end will never resolve
       * we use settimeout for handling this case
       */
      // Devices occasionally don't send FIN — resolve anyway after the fallback.
      const timer = setTimeout(() => {
        resolve(true)
      }, TIMEOUTS.CLOSE_SOCKET)
    })
  }

  writeMessage(msg, connect) {
    return new Promise((resolve, reject) => {

      let timer = null
      this.socket.once('data', (data) => {
        timer && clearTimeout(timer)
        resolve(data)
      })

      this.socket.write(msg, null, async (err) => {
        if (err) {
          reject(err)
        } else if (this.timeout) {
          // Connect/exit commands get a fixed short window; data commands honor user timeout.
          timer = setTimeout(() => {
            clearTimeout(timer)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? TIMEOUTS.CONNECT : this.timeout)
        }
      })
    })
  }

  requestData(msg) {
    return new Promise((resolve, reject) => {
      let timer = null
      let replyBuffer = Buffer.from([])
      const internalCallback = (data) => {
        this.socket.removeListener('data', handleOnData)
        timer && clearTimeout(timer)
        resolve(data)
      }

      const handleOnData = (data) => {
        replyBuffer = Buffer.concat([replyBuffer, data])
        if (isEventPacketTCP(data)) return;
        clearTimeout(timer)   
        const header = decodeTCPHeader(replyBuffer.subarray(0, PROTOCOL.TCP_FULL_HEADER_LEN));

        if (header.commandId === COMMANDS.CMD_DATA) {
          // After a CMD_DATA frame we wait a short quiet period before resolving,
          // because the device sometimes splits the payload across two writes.
          timer = setTimeout(() => {
            internalCallback(replyBuffer)
          }, TIMEOUTS.PACKET_END)
        }else{
          timer = setTimeout(() => {
            reject(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA'))
          }, this.timeout)

          const packetLength = data.readUIntLE(4, 2)
          if (packetLength > PROTOCOL.ZK_HEADER_LEN) {
            internalCallback(data)
          }
        }
      }


      
      this.socket.on('data', handleOnData)

      this.socket.write(msg, null, err => {
        if (err) {
          reject(err)
        }

        timer = setTimeout(() => {
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

      if (![COMMANDS.CMD_CONNECT, COMMANDS.CMD_AUTH].includes(command) && !this.is_connect) {
        // Reject (not throw) so the surrounding Promise resolves correctly.
        // Use the ZKError constructor signature: (err, command, ip).
        return reject(new ZKError(new Error('NOT_CONNECTED'), 'executeCmd', this.ip))
      }

      if (command === COMMANDS.CMD_CONNECT) {
        this.sessionId = 0
        this.replyId = 0
      } else {
        this.replyId++
      }
      const buf = createTCPHeader(command, this.sessionId, this.replyId, data)
      let reply = null

      try{
        reply = await this.writeMessage(buf, command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT)

        const rReply = removeTcpHeader(reply);
        // Only parse the session id when the reply is at least one full ZK header.
        if (rReply && rReply.length >= PROTOCOL.ZK_HEADER_LEN) {
          if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = rReply.readUInt16LE(4);
          }
        }
        resolve(rReply)
      }catch(err){
        reject(err)
      }
    })
  }

  sendChunkRequest(start, size) {
    this.replyId++;
    const reqData = Buffer.alloc(8)
    reqData.writeUInt32LE(start, 0)
    reqData.writeUInt32LE(size, 4)
    const buf = createTCPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData)

    this.socket.write(buf, null, err => {
      if (err) {
        log(`[TCP][SEND_CHUNK_REQUEST]` + err.toString())
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
      const buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData)
      let reply = null

      try {
        reply = await this.requestData(buf)

      } catch (err) {
        reject(err)
      }

      const header = decodeTCPHeader(reply.subarray(0, PROTOCOL.TCP_FULL_HEADER_LEN))
      switch (header.commandId) {
        case COMMANDS.CMD_DATA: {
          resolve({ data: reply.subarray(PROTOCOL.TCP_FULL_HEADER_LEN), mode: 8 })
          break;
        }
        case COMMANDS.CMD_ACK_OK:
        case COMMANDS.CMD_PREPARE_DATA: {
          // this case show that data is prepared => send command to get these data 
          // reply variable includes information about the size of following data
          const recvData = reply.subarray(PROTOCOL.TCP_FULL_HEADER_LEN)
          const size = recvData.readUIntLE(1, 4)


          // We need to split the data to many chunks to receive , because it's to large
          // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
          const maxChunk = this.maxChunk || MAX_CHUNK
          let remain = size % maxChunk
          let numberChunks = Math.round(size - remain) / maxChunk
          let totalPackets = numberChunks + (remain > 0 ? 1 : 0)
          let replyData = Buffer.from([])


          let totalBuffer = Buffer.from([])
          let realTotalBuffer = Buffer.from([])


          // Respect the configured timeout instead of a fixed value, so
          // slow/high-latency links can allow more time between packets.
          const timeout = this.timeout || TIMEOUTS.CHUNK_TCP
          let timer = setTimeout(() => {
            internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)


          const internalCallback = (replyData, err = null) => {
            // this.socket && this.socket.removeListener('data', handleOnData)
            timer && clearTimeout(timer)
            resolve({ data: replyData, err })

          }


          const handleOnData = (reply) => {

            if (isEventPacketTCP(reply)) return;
            clearTimeout(timer)
            timer = setTimeout(() => {
              internalCallback(replyData,
                new Error(`TIME OUT !! ${totalPackets} PACKETS REMAIN !`))
            }, timeout)

            totalBuffer = Buffer.concat([totalBuffer, reply])
            const packetLength = totalBuffer.readUIntLE(4, 2)
            if (totalBuffer.length >= PROTOCOL.TCP_PREFIX_LEN + packetLength) {

              realTotalBuffer = Buffer.concat([
                realTotalBuffer,
                totalBuffer.subarray(PROTOCOL.TCP_FULL_HEADER_LEN, PROTOCOL.TCP_PREFIX_LEN + packetLength),
              ])
              totalBuffer = totalBuffer.subarray(PROTOCOL.TCP_PREFIX_LEN + packetLength)

              if ((totalPackets > 1 && realTotalBuffer.length === maxChunk + PROTOCOL.ZK_HEADER_LEN)
                || (totalPackets === 1 && realTotalBuffer.length === remain + PROTOCOL.ZK_HEADER_LEN)) {

                replyData = Buffer.concat([replyData, realTotalBuffer.subarray(PROTOCOL.ZK_HEADER_LEN)])
                totalBuffer = Buffer.from([])
                realTotalBuffer = Buffer.from([])

                totalPackets -= 1
                cb && cb(replyData.length, size)

                if (totalPackets <= 0) {
                  internalCallback(replyData)
                } else {
                  // This chunk is complete — request the next one.
                  requestNextChunk()
                }
              }
            }
          }

          // Request chunks sequentially: ask for one chunk, wait for it to fully
          // arrive, then ask for the next. Firing every chunk request up front
          // works on a LAN but stalls over a slow/high-latency (WAN) link after a
          // couple of chunks — the device's send buffer fills faster than the link
          // drains it and the remaining chunks never arrive, truncating the
          // download. Keeping one chunk in flight lets the slow link keep up.
          let nextChunk = 0
          const requestNextChunk = () => {
            if (nextChunk > numberChunks) return
            if (nextChunk === numberChunks) {
              this.sendChunkRequest(numberChunks * maxChunk, remain)
            } else {
              this.sendChunkRequest(nextChunk * maxChunk, maxChunk)
            }
            nextChunk++
          }

          this.socket.once('close', () => {
            internalCallback(replyData, new Error('Socket is disconnected unexpectedly'))
          })

          this.socket.on('data', handleOnData);

          requestNextChunk()

          break;
        }
        default: {
          reject(new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)))
        }
      }
    })
  }


  /**
   *  reject error when starting request data
   *  return { data: users, err: Error } when receiving requested data
   */
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


    // TCP firmwares emit 72-byte user records. The first 4 bytes of the reply
    // payload are a count header — skip them before record parsing.
    const recordSize = PACKET_SIZES.USER_TCP

    let userData = data.data.subarray(4)
    const users = []

    while (userData.length >= recordSize) {
      users.push(decodeUserData72(userData.subarray(0, recordSize)))
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
    try {
      data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS, callbackInProcess)
    } catch (err) {
      return Promise.reject(err)
    }

    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }


    // First 4 bytes of payload = count header; remainder is fixed-width records.
    const recordSize = PACKET_SIZES.ATT_LOG_TCP

    let recordData = data.data.subarray(4)
    const records = []
    while (recordData.length >= recordSize) {
      const record = decodeRecordData40(recordData.subarray(0, recordSize))
      records.push({ ...record, ip: this.ip })
      recordData = recordData.subarray(recordSize)
    }

    return { data: records, err: data.err }

  }

  async getTime() {
		const time = await this.executeCmd(COMMANDS.CMD_GET_TIME, '');
		return timeParser.decode(time.readUInt32LE(8));
	}
  
  async freeData() {
    return await this.executeCmd(COMMANDS.CMD_FREE_DATA, '')
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

    }
    return await this.closeSocket()
  }

  async getInfo() {
    try {
      const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '')

      // CMD_GET_FREE_SIZES reply layout — see FREE_SIZES_OFFSETS.
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

  async getRealTimeLogs(cb = () => { }) {
    this.replyId++;

    const buf = createTCPHeader(COMMANDS.CMD_REG_EVENT, this.sessionId, this.replyId, Buffer.from([0x01, 0x00, 0x00, 0x00]))

    this.socket.write(buf, null, err => {
    })

    this.socket.listenerCount('data') === 0 && this.socket.on('data', (data) => {

      // Only forward real-time event packets; ignore replies to other in-flight commands.
      if (!isEventPacketTCP(data)) return;
      if (data.length > PROTOCOL.TCP_FULL_HEADER_LEN) {
        cb(decodeRecordRealTimeLog52(data))
      }

    })

  }

}




module.exports = ZKLibTCP
