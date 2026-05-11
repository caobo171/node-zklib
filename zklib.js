/**
 * node-zklib — public client class.
 *
 * Owns one ZKLibTCP and one ZKLibUDP transport. Every public method delegates
 * through functionWrapper(), which dispatches based on connectionType
 * ('tcp' | 'udp') and wraps thrown errors as ZKError instances.
 *
 * Connection strategy: createSocket() always tries TCP first; on ECONNREFUSED
 * it falls back to UDP. UDP EADDRINUSE during bind is treated as success
 * (socket already bound from a previous run).
 */
const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError, ERROR_TYPES } = require('./zkerror')

class ZKLib {
    /**
     * @param {string} ip          Device IP address.
     * @param {number} port        Device TCP/UDP port (typically 4370).
     * @param {number} timeout     Per-request timeout in milliseconds.
     * @param {number} inport      Local UDP bind port (used only on UDP fallback).
     * @param {number} [comm_code] Device communication password (0 = disabled).
     * @param {string} [protocol]  'tcp' | 'udp'. Omit to auto-detect (TCP, then UDP).
     */
    constructor(ip, port, timeout, inport, comm_code = 0, protocol = null) {
        // null until createSocket() succeeds; functionWrapper rejects calls before then.
        this.connectionType = protocol

        this.zklibTcp = new ZKLibTCP(ip, port, timeout, comm_code)
        this.zklibUdp = new ZKLibUDP(ip, port, timeout, inport, comm_code)
        this.interval = null
        this.timer = null
        this.isBusy = false
        this.ip = ip
        this.comm_code = comm_code || undefined
    }

    async functionWrapper (tcpCallback, udpCallback , command ){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    try{
                        const res =  await tcpCallback()
                        return res
                    }catch(err){
                        return Promise.reject(new ZKError(
                            err,
                            `[TCP] ${command}`,
                            this.ip
                        ))
                    }
                }else{
                    return Promise.reject(new ZKError(
                        new Error( `Socket isn't connected !`),
                        `[TCP]`,
                        this.ip
                    ))
                }
            case 'udp':
                if(this.zklibUdp.socket){
                    try{
                        const res =  await udpCallback()
                        return res
                    }catch(err){
                        return Promise.reject(new ZKError(
                            err,
                            `[UDP] ${command}`,
                            this.ip
                        ))
                    }    
                }else{
                    return Promise.reject(new ZKError(
                        new Error( `Socket isn't connected !`),
                        `[UDP]`,
                        this.ip
                    ))
                }
            default:
                return Promise.reject(new ZKError(
                    new Error("Socket isn't connected — call createSocket() first"),
                    command || 'functionWrapper',
                    this.ip
                ))
        }
    }

    /**
     * Open the device connection. Tries TCP first, falls back to UDP on ECONNREFUSED.
     * @param {(err: Error) => void} [cbErr]   Optional socket-error callback.
     * @param {(transport: 'tcp' | 'udp') => void} [cbClose] Optional close callback.
     * @returns {Promise<void>} Rejects with ZKError if neither transport connects.
     */
    async createSocket(cbErr, cbClose){
        try{
            if(!this.zklibTcp.socket){
                try{
                    await this.zklibTcp.createSocket(cbErr,cbClose)
                   

                }catch(err){
                    throw err;
                }
              
                try{
                    await this.zklibTcp.connect();
                    this.zklibTcp.is_connect = true
                }catch(err){
                    throw err;
                }
            }      

            this.connectionType = 'tcp'

        }catch(err){
            try{
                await this.zklibTcp.disconnect()
            }catch(err){}

            if(err.code !== ERROR_TYPES.ECONNREFUSED){
                return Promise.reject(new ZKError(err, 'TCP CONNECT' , this.ip))
            }

            try {
                if(!this.zklibUdp.socket){
                    await this.zklibUdp.createSocket(cbErr, cbClose)
                    await this.zklibUdp.connect()
                }   
                
                this.connectionType = 'udp'
            }catch(err){



                if(err.code !== 'EADDRINUSE'){
                    this.connectionType = null
                    try{
                        await this.zklibUdp.disconnect()
                        this.zklibUdp.socket = null
                        this.zklibTcp.socket = null
                    }catch(err){}


                    return Promise.reject(new ZKError(err, 'UDP CONNECT' , this.ip))
                }else{
                    this.connectionType = 'udp'
                    
                }
                
            }
        }
    }

    /**
     * @returns {Promise<{ data: object[], err: Error|null }>}
     *   `data` is an array of users; shape differs by transport (see README).
     */
    async getUsers(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUsers(),
            ()=> this.zklibUdp.getUsers()
        )
    }

    /**
     * @param {(received: number, total: number) => void} [cb]
     *   Progress callback fired as chunks arrive.
     * @returns {Promise<{ data: object[], err: Error|null }>} Attendance records.
     */
    async getAttendances(cb){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getAttendances(cb),
            ()=> this.zklibUdp.getAttendances(cb),
        )
    }

    /**
     * Subscribe to real-time attendance events. Resolves immediately after
     * registering; events arrive via the callback until disconnect().
     * @param {(event: { userId: string, attTime: Date }) => void} cb
     */
    async getRealTimeLogs(cb){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getRealTimeLogs(cb),
            ()=> this.zklibUdp.getRealTimeLogs(cb)
        )
    }

    /**
     * Send CMD_EXIT and close the socket. Safe to call when already disconnected.
     * @returns {Promise<boolean>}
     */
    async disconnect(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.disconnect(),
            ()=> this.zklibUdp.disconnect()
        )
    }

    /**
     * Tell the device to release its internal data buffer. Called automatically
     * before and after getUsers/getAttendances; rarely needed directly.
     */
    async freeData(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.freeData(),
            ()=> this.zklibUdp.freeData()
        )
    }
    
    /** @returns {Promise<Date>} The device's current local time. */
	async getTime() {
		return await this.functionWrapper(
			() => this.zklibTcp.getTime(),
			() => this.zklibUdp.getTime()
		);
	}

    /** Put the device into a disabled state (no keyboard, no fingerprint). */
    async disableDevice(){
        return await this. functionWrapper(
            ()=>this.zklibTcp.disableDevice(),
            ()=>this.zklibUdp.disableDevice()
        )
    }


    /** Re-enable the device after disableDevice(). */
    async enableDevice(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.enableDevice(),
            ()=> this.zklibUdp.enableDevice()
        )
    }


    /**
     * @returns {Promise<{ userCounts: number, logCounts: number, logCapacity: number }>}
     */
    async getInfo(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getInfo(),
            ()=>this.zklibUdp.getInfo()
        )
    }


    async getSocketStatus(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.getSocketStatus(),
            ()=> this.zklibUdp.getSocketStatus()
        )
    }

    /**
     * Delete all attendance records on the device. Irreversible.
     * Recommended when the device approaches `logCapacity`; large logs slow it down.
     */
    async clearAttendanceLog(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.clearAttendanceLog(),
            ()=> this.zklibUdp.clearAttendanceLog()
        )
    }

    /**
     * Send an arbitrary ZK protocol command. Use this for opcodes not covered
     * by a first-class method. Opcode reference:
     * https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md
     * @param {number} command  Numeric opcode (see COMMANDS in constants.js).
     * @param {Buffer|string} [data] Optional payload.
     */
    async executeCmd(command, data=''){
        return await this.functionWrapper(
            ()=> this.zklibTcp.executeCmd(command, data),
            ()=> this.zklibUdp.executeCmd(command , data)
        )
    }

    setIntervalSchedule(cb , timer){
        this.interval = setInterval(cb, timer)
    }


    setTimerSchedule(cb, timer){
        this.timer = setTimeout(cb,timer)
    }

    

}


module.exports = ZKLib
