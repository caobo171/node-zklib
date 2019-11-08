const net = require('net')
const { MAX_CHUNK, COMMANDS , REQUEST_DATA} = require('./constants')
const {createTCPHeader,
    exportErrorMessage, 
    removeTcpHeader, 
    decodeUserData72,  
    decodeRecordData40, 
    decodeRecordRealTimeLog52 , 
    checkNotEventTCP,
    decodeTCPHeader} = require('./utils')

const { log } = require('./helpers/errorLog')

class ZKLibTCP {
    constructor(ip, port, timeout ){
        this.ip = ip
        this.port = port
        this.timeout = timeout
        this.sessionId = null
        this.replyId = 0
        this.socket = null 
    }   

    getSocketStatus(){
      console.log('check getSOcketStatus', this.socket.remoteAddress)
    }

    createSocket(cbError , cbClose){
      return new Promise((resolve, reject)=>{
        this.socket = new net.Socket()

        this.socket.on('error',err => {
          console.log('error tcp', err)
          reject(err)
          cbError && cbError(err)
        })

        this.socket.once('connect', ()=> {

          resolve(this.socket)
        })

        this.socket.on('close', (err)=>{
          console.log('check closed')
          this.socket = null;
          cbClose  && cbClose('tcp')
        })


        if(this.timeout){
          this.socket.setTimeout(this.timeout)
        }

        this.socket.connect(this.port, this.ip)
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
            this.socket.removeAllListeners('data')
            this.socket.end(()=>{
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

        let timer = null
        this.socket.once('data',(data)=> {
            timer && clearTimeout(timer)
            resolve(data)
        })

        this.socket.write(msg,null, err=> {
            if(err){
                reject(err)
            }
            if(this.timeout){
              timer = setTimeout(()=>{
                clearTimeout(timer)
                reject(Error('TIMEOUT ERROR'))
              }, connect ? 2000: this.timeout  )
            }
        })
      })
    }

    requestData(msg){
        return new Promise((resolve, reject)=>{
            let timer = null

            const internalCallback = (data)=>{
              this.socket.removeListener('data', handleOnData)
              timer && clearTimeout(timer)
              resolve(data)
            }

            const handleOnData = (data)=>{
              if(checkNotEventTCP(data)) return ;
              clearTimeout(timer)
              timer = setTimeout(()=>{
                reject('TIMEOUT ERROR')
              },this.timeout)

              const packetLength = data.readUIntLE(4, 2)
              if(packetLength > 8){
                internalCallback(data)
              }

              replyBuffer = Buffer.concat([replyBuffer, data ])
            }


            let replyBuffer = Buffer.from([])
            this.socket.on('data',handleOnData)
    
            this.socket.write(msg,null, err=> {
                if(err){
                    reject(err)
                }
                timer = setTimeout(()=>{
                  reject('TIMEOUT ERROR')
                },this.timeout)
            })
        })

    }

    executeCmd(command , data){
        return new Promise(async (resolve, reject)=>{

            try{
              if(command === COMMANDS.CMD_CONNECT ) {// CONNECT 
                this.sessionId = 0 
                this.replyId = 0 
              }else{
                  this.replyId ++ 
              }
              const buf = createTCPHeader(command , this.sessionId, this.replyId, data)
              const reply = await this.writeMessage(buf, command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT)
              
              const rReply = removeTcpHeader(reply);
              if (rReply && rReply.length && rReply.length >= 0 ) {
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

    sendChunkRequest(start, size ){
      this.replyId ++ ;
      const reqData = Buffer.alloc(8)
      reqData.writeUInt32LE(start, 0)
      reqData.writeUInt32LE(size, 4)
      const buf = createTCPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData )

      this.socket.write(buf,null, err=> {
        if(err ){
        }
      })
    }

    readWithBuffer(reqData , cb = null ){
      return new Promise(async (resolve, reject)=> {

        this.replyId ++ ;
        const buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId , reqData)
        let reply = null

        try{
          reply = await this.requestData(buf)
       
        }catch(err){
          reject(err)
        }
        
        const header = decodeTCPHeader(reply.subarray(0,16))
        switch(header.commandId){
          case COMMANDS.CMD_DATA: {
            resolve( { data: reply.subarray(16), mode: 8 })
            break;
          }
          case COMMANDS.CMD_ACK_OK:
          case COMMANDS.CMD_PREPARE_DATA:{
            // this case show that data is prepared => send command to get these data 
            // reply variable includes information about the size of following data
            const recvData = reply.subarray(16)
            const size = recvData.readUIntLE(1,4)


            // We need to split the data to many chunks to receive , because it's to large
            // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
            let remain = size % MAX_CHUNK
            let numberChunks = Math.round(size-remain)/ MAX_CHUNK
            let totalPackets = numberChunks + (remain > 0 ? 1 : 0)
            let replyData = Buffer.from([])
    
    
            let totalBuffer = Buffer.from([])
            let realTotalBuffer = Buffer.from([])
    

            const timeout = 10000
            let timer = setTimeout(()=>{
              internalCallback(replyData, 'TIMEOUT WHEN RECEIVING PACKET ')
            }, timeout)


            const internalCallback = (replyData, err = null )=>{
              this.socket && this.socket.removeListener('data',handleOnData)
              timer && clearTimeout(timer)
              if(err){
                resolve({ data:replyData , err })
              }else{
                resolve({ data:replyData , err: null })
              }
            }
    
    
            const handleOnData = (reply)=>{
              if(checkNotEventTCP(reply)) return ;
              clearTimeout(timer)
              timer = setTimeout(()=>{
                internalCallback( replyData , `TIME OUT !! ${totalPackets} PACKETS REMAIN !`)
              }, timeout)
 

              totalBuffer = Buffer.concat([totalBuffer,reply])
              const packetLength = totalBuffer.readUIntLE(4, 2)
              if(totalBuffer.length >= 8 + packetLength ){
      
                  realTotalBuffer = Buffer.concat([realTotalBuffer, totalBuffer.subarray(16, 8+packetLength )])
                  totalBuffer = totalBuffer.subarray(8+packetLength)
      
                  if( (totalPackets > 1 && realTotalBuffer.length === MAX_CHUNK + 8 ) 
                      || (totalPackets === 1 && realTotalBuffer.length === remain + 8) ){
                    
                      replyData = Buffer.concat([replyData, realTotalBuffer.subarray(8)])
                      totalBuffer = Buffer.from([])
                      realTotalBuffer = Buffer.from([])
    
                      totalPackets -= 1 
                      cb && cb( replyData.length , size )
    
                      if(totalPackets <= 0 ){
                          internalCallback(replyData)
                      }
                  }
              }
            }

            this.socket.once('close', ()=>{
              internalCallback( replyData, 'Socket is disconnected unexpectedly')
            })
    
            this.socket.on('data', handleOnData);

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
          log(`[314] ${err.toString()}`)
          return { data: [], err: err.toString()}
        }

        if(this.socket){
          await this.freeData()
        }
        const USER_PACKET_SIZE = 72
          
        let userData = data.data.subarray(4)
    
        let users = []
    
        while(userData.length >= USER_PACKET_SIZE){
          const user = decodeUserData72(userData.subarray(0, USER_PACKET_SIZE))
          users.push(user)
          userData = userData.subarray(USER_PACKET_SIZE)
        }
        return { data: users, err:data.err} 
      }catch(err){

        log(`[335] ${err.toString()}`)
        return {data: [] , err: err.toString() }
      }

    }

    async getAttendances(ip, cb = ()=>{}){
      try{
        if(this.socket){
          await this.freeData()
        }
        
        let data = null 
        try{
          data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS,cb)
        }catch(err){

          log(`[352] ${err.toString()}`)
          return { data: [], err: err.toString()}
        }

        if(this.socket){
          await this.freeData()
        }
        

        const RECORD_PACKET_SIZE = 40 

        let recordData = data.data.subarray(4)  
        let records = []
        while(recordData.length >= RECORD_PACKET_SIZE){
          const record = decodeRecordData40(recordData.subarray(0, RECORD_PACKET_SIZE))
          records.push({ ...record, ip})
          recordData = recordData.subarray(RECORD_PACKET_SIZE)
        }
    
        return { data: records , err: data.err}
      }catch(err){

        log(`[374] ${err.toString()}`)
        return {data: [] , err: err.toString() }
      }
 
    }

    async freeData(){
      return await this.executeCmd(COMMANDS.CMD_FREE_DATA,'') 
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
        }catch(err){

          log(`[397] ${err.toString()}`)
        }
       
        return await this.closeSocket()
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

    async getRealTimeLogs(cb= ()=>{}){
      this.replyId ++ ;

      const buf = createTCPHeader(COMMANDS.CMD_REG_EVENT , this.sessionId, this.replyId , Buffer.from([0x01,0x00,0x00, 0x00]))
   
      this.socket.write(buf,null, err=> {
      })
      
      this.socket.listenerCount('data') === 0 && this.socket.on('data', (data)=>{
        if(!checkNotEventTCP(data)) return ;
        if(data.length > 16){
          cb(decodeRecordRealTimeLog52(data))
        }

      })
      
    }


}




module.exports = ZKLibTCP