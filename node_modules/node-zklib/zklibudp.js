const dgram = require('dgram')
const { 
  createUDPHeader , 
  decodeUserData28 , 
  decodeRecordData16 ,
  decodeRecordRealTimeLog18,
  decodeUDPHeader, 
  exportErrorMessage,
  checkNotEventUDP
 } = require('./utils') 

const { MAX_CHUNK , REQUEST_DATA , COMMANDS } = require('./constants')

const { log } = require('./helpers/errorLog')

class ZKLibUDP {
    constructor(ip, port, timeout , inport ){
        this.ip = ip
        this.port = port
        this.timeout = timeout
        this.socket = null
        this.sessionId = null
        this.replyId = 0
        this.inport = inport
    }   

    createSocket(cbError , cbClose){
      return new Promise((resolve, reject)=>{
        this.socket = dgram.createSocket('udp4');
        this.socket.setMaxListeners(Infinity)
        this.socket.once('error',err => {
          console.log('error udp', err)
          reject(err)
          cbError && cbError(err)
        })

        this.socket.on('close', (err)=>{
          this.socket = null;
          cbClose  && cbClose('udp') 
        })

        this.socket.once('listening', ()=> {
          resolve(this.socket)
        })
        try{
          this.socket.bind(this.inport)
        }catch(err){
        }
        
      })
    }

    connect(){
       return new Promise (async (resolve, reject)=> {
          try{
            const reply = await this.executeCmd(COMMANDS.CMD_CONNECT,'')
            if(reply){
              resolve(true)
            }else {
              reject(false)
            }
          }catch(err){
            reject(err)
          }
       })
    }


    closeSocket(){
        return new Promise((resolve, reject)=>{
            this.socket.removeAllListeners('message')
            this.socket.close(()=>{
                clearTimeout(timer)
                resolve(true)
            })

            /**
             * When socket isn't connected so this.socket.end will never resolve
             * we use settimeout for handling this case
             */
            const timer = setTimeout(()=>{
              resolve(true)
            }, 2000)
        })
    }

    writeMessage(msg , connect){
      return new Promise((resolve, reject)=>{
            let sendTimeoutId ;
            this.socket.once('message',(data)=> {
                sendTimeoutId && clearTimeout(sendTimeoutId)
                resolve(data)
            })

            this.socket.send(msg, 0,msg.length, this.port, this.ip, (err)=>{
                if(err ) {
                    reject(err)
                }
                if(this.timeout){
                    sendTimeoutId = setTimeout(()=>{
                        clearTimeout(sendTimeoutId)
                        reject(Error('TIMEOUT ERROR'))
                    }, connect ? 2000: this.timeout )
                }
            })
        })
    }

    requestData(msg){
        return new Promise((resolve, reject)=>{
            let sendTimeoutId
            const internalCallback = (data)=>{
              sendTimeoutId && clearTimeout(sendTimeoutId)
              this.socket.removeListener('message', handleOnData)
              resolve(data)
            }

            const handleOnData = (data)=>{
                if(checkNotEventUDP(data)) return;
                clearTimeout(sendTimeoutId)
                sendTimeoutId = setTimeout(()=>{
                    reject(Error('TIMEOUT ERROR'))
                }, this.timeout)

                if(data.length >= 13){
                  internalCallback(data)
                }
                
            }

            this.socket.on('message',handleOnData)

            this.socket.send(msg, 0,msg.length, this.port, this.ip, (err)=>{
              if(err ) {
                  reject(err)
              }
              sendTimeoutId = setTimeout(()=>{
                reject(Error('TIMEOUT ERROR'))
              }, this.timeout)
              
          })
        })

    }

    executeCmd(command , data){
        return new Promise(async (resolve, reject)=>{
            try{
              if(command === COMMANDS.CMD_CONNECT) {// CONNECT 
                this.sessionId = 0 
                this.replyId = 0 
              }else{
                  this.replyId ++ 
              }


              const buf = createUDPHeader(command , this.sessionId, this.replyId, data)
              const reply = await this.writeMessage(buf , command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT)

              if (reply && reply.length && reply.length >= 0 ) {
                  if (command === COMMANDS.CMD_CONNECT) {
                    this.sessionId = reply.readUInt16LE(4);
                  }
              }
              resolve(reply)
            }catch(err){
              reject(err)
            }
        })
    }

    sendChunkRequest(start, size ){
      this.replyId ++ ;
      const reqData = Buffer.alloc(8)
      reqData.writeUInt32LE(start, 0)
      reqData.writeUInt32LE(size, 4)
      const buf = createUDPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData )

      this.socket.send(buf, 0, buf.length, this.port, this.ip, (err)=>{
        if(err ) {
        }
      })
    }

    

    readWithBuffer(reqData , cb = null ){
      return new Promise(async (resolve, reject)=> {
        this.replyId ++ ;
        const buf = createUDPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId , reqData)
        
        
        let reply = null
        try{
          reply = await this.requestData(buf)
        }catch(err){
          reject(err)
        }

        const header = decodeUDPHeader(reply.subarray(0,8))
        
        switch(header.commandId){      
          case COMMANDS.CMD_DATA :{
            resolve( { data: reply.subarray(8), mode: 8 , err:null })
            break;
          }
          case COMMANDS.CMD_ACK_OK : 
          case COMMANDS.CMD_PREPARE_DATA  :{
            // this case show that data is prepared => send command to get these data 
            // reply variable includes information about the size of following data 
            const recvData = reply.subarray(8)
            const size = recvData.readUIntLE(1,4)
            
            // We need to split the data to many chunks to receive , because it's to large
            // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
            let remain = size % MAX_CHUNK
            let numberChunks = Math.round(size-remain)/ MAX_CHUNK
    
            let totalBuffer = Buffer.from([])


            const timeout = 3000
            let timer = setTimeout(()=>{
              internalCallback(totalBuffer, 'TIMEOUT WHEN RECEIVING PACKET ')
            }, timeout)


            const internalCallback = (replyData , err= null)=>{
              this.socket.removeListener('message',handleOnData)
              timer && clearTimeout(timer)
              if(err){
                resolve({err , data: replyData})
              }else{
                resolve({err: null, data: replyData} )
              }
            }

 
            const handleOnData = (reply)=>{
              if(checkNotEventUDP(reply)) return;
              clearTimeout(timer)
              timer = setTimeout(()=>{
                internalCallback(totalBuffer, 'TIMEOUT WHEN RECEIVING PACKET ')
              }, timeout)
              const header = decodeUDPHeader(reply)

              switch(header.commandId){
                case COMMANDS.CMD_PREPARE_DATA:{
                  break;
                }
                case COMMANDS.CMD_DATA : {
                  totalBuffer = Buffer.concat( [totalBuffer, reply.subarray(8)])
                  cb && cb(totalBuffer.length , size)
                  break;
                }
                case COMMANDS.CMD_ACK_OK: {
                  if(totalBuffer.length === size){
                    internalCallback(totalBuffer)
                  }
                  break;
                }
                default :{
                  internalCallback(totalBuffer , exportErrorMessage(header.commandId) )
                }
              }
            }
    
            this.socket.on('message', handleOnData);
      
            for(let i =0 ; i<= numberChunks ; i++){
              if ( i === numberChunks ){
                this.sendChunkRequest(numberChunks * MAX_CHUNK , remain)
              } else {
                this.sendChunkRequest(i* MAX_CHUNK , MAX_CHUNK)
              }
            }

            break;
          }
          default:{
            reject({err: exportErrorMessage(header.commandId)})
          }
        }
      })
    }


    async getUsers(){
      try{
        if(this.socket){
          await this.freeData()
        }
        
        let data = null
        try{
          data = await this.readWithBuffer(REQUEST_DATA.GET_USERS)
        }catch(err){

          log(`[298] ${err.toString()}`)
          return { data: [] , err: err.toString()}
        }

        if(this.socket){
          await this.freeData()
        }

        const USER_PACKET_SIZE = 28
        let userData = data.data.subarray(4)
        let users = []

        while(userData.length >= USER_PACKET_SIZE){
          const user = decodeUserData28(userData.subarray(0, USER_PACKET_SIZE))
          users.push(user)
          userData = userData.subarray(USER_PACKET_SIZE)
        }

        return {data: users , err: data.err} 
      }catch(err){

        log(`[317] ${err.toString()}`)
        return { data: [], err: err.toString()}
      }
    }


    async getAttendances( ip, cb = ()=>{}){
      try{
        if(this.socket){
          await this.freeData()
        }
        let data = null

        data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS ,cb)

        if(this.socket){
          await this.freeData()
        }

        if(data.mode){
          // Data too small to decode in a normal way  => we need a parameter to indicate this case 
          const RECORD_PACKET_SIZE = 8 
          let recordData = data.data.subarray(4)  

          let records = []
          while(recordData.length >= RECORD_PACKET_SIZE){
            const record = decodeRecordData16(recordData.subarray(0, RECORD_PACKET_SIZE))
            records.push({...record, ip})
            recordData = recordData.subarray(RECORD_PACKET_SIZE)
          }
    
          return {data: records , err: data.err }

        }else{
          const RECORD_PACKET_SIZE = 16
          let recordData = data.data.subarray(4)  
    
          let records = []
          while(recordData.length >= RECORD_PACKET_SIZE){
            const record = decodeRecordData16(recordData.subarray(0, RECORD_PACKET_SIZE))
            records.push({...record, ip})
            recordData = recordData.subarray(RECORD_PACKET_SIZE)
          }
    
          return {data: records , err: data.err}
        }      
      }catch(err){

        log(`[363] ${err.toString()}`)
        return {data: [] , err: err.toString() }
      }
    }



    async freeData(){
      return await this.executeCmd(COMMANDS.CMD_FREE_DATA,'') 
    }


    async getInfo(){
      const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES,'')
      try{
        return {
          userCounts: data.readUIntLE(24,4),
          logCounts: data.readUIntLE(40,4)
        }
      }catch(err){
        return {}
      }
    }

    async disableDevice(){
       return await this.executeCmd(COMMANDS.CMD_DISABLEDEVICE, REQUEST_DATA.DISABLE_DEVICE )
    }

    async enableDevice(){
       return await this.executeCmd(COMMANDS.CMD_ENABLEDEVICE,'')
    }

    async disconnect(){
        try{
          await this.executeCmd(COMMANDS.CMD_EXIT, '')
        } catch(err){
          log(`[384] ${err.toString()}`)
        }
        return await this.closeSocket()
    }



    async getRealTimeLogs(cb= ()=>{}){
      this.replyId ++ ;
      const buf = createUDPHeader( COMMANDS.CMD_REG_EVENT , this.sessionId, this.replyId , REQUEST_DATA.GET_REAL_TIME_EVENT)
          
      this.socket.send(buf, 0,buf.length, this.port, this.ip, (err)=>{

      })

      this.socket.listenerCount('message') < 2 && this.socket.on('message', (data)=>{

        if(!checkNotEventUDP(data)) return ;
        if(data.length === 18){
          cb(decodeRecordRealTimeLog18(data))
        }
      })
      
    }
}




module.exports = ZKLibUDP