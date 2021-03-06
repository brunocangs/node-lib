var restful = require('node-restful');
var CronJob = require('cron').CronJob;
var mongoose = restful.mongoose;

var AMMailing = require('./am-mailing');

/*
    @todo
    [ ] - Provide invite stats to admin
    [ ] - Check if email is already a user
 */

class AMInvite {
    static setup (config) {
        // Validate
        // Check for mongooseit
        if (process.env.NODE_ENV !== 'test' && typeof mongoose.model('invite').findIt === 'undefined') {
            throw new Error('You must use mongooseit plugin on you "invite" schema');
        }
        // Config
        AMInvite.config = config;
        AMInvite.model = mongoose.model('invite');

        // Initialize queue
        // AMInvite.queue = [];
        // AMInvite cron
        // AMInvite.cron = new CronJob({
        //     cronTime: '00 30 11 * * 1-7',
        //     onTick: () => AMInvite.createQueue(),
        //     start: true,
        //     timeZone: 'America/Los_Angeles',
        //     runOnInit: true
        // });

        return true;
    }

    static isActive () {
        return AMInvite.config !== null;
    }

    static setAcceptCallback (cb) {
        AMInvite.acceptCallback = cb;
    }

    static async getUserLink (user, unique) {
        const connection = mongoose.connection;
        const Invite = connection.model('invite');
        let invite = null;
        let inviteObj = {};

        // Unique ?
        if (unique === true) {
            // Find the unique link
            inviteObj = {user: user, main: true};
            invite = await Invite.findOne(inviteObj);
        } else {
            // Create a specific invite link
            inviteObj = {
                user: user,
                main: false,
                accepted: false
            };
        }

        // If not unique or unique invite not found
        if (!invite) {
            invite = await Invite.create(inviteObj);
        }

        const url = AMInvite.config.baseUrlAndRoute + '/' + invite._id.toString();
        return url;
    }

    static async addInvite (user, emailToInvite, phoneToInvite) {
        try {
            let connection = mongoose.connection;
            const Invite = connection.model('invite');

            // Check if email or phone already invited
            // let existingInvite = await AMInvite.findInviteByEmailPhone(emailToInvite, phoneToInvite);
            // console.log(" >> invite << ",existingInvite);

            // if (existingInvite)
            //     return existingInvite;

            // Check if email is already a user - @TODO

            // Invite it!
            let invite = {
                user: user,
                email: emailToInvite,
                phone: phoneToInvite,
                main: false,
                accepted: false
            };
            invite = await Invite.create(invite);
            if (AMInvite.config.sendEmail && emailToInvite) {
                const subject = '[' + AMMailing.config.fromName + '] Você recebeu um convite';
                const text = 'Seu amigo ' + (user.name ? user.name : '') + ' (' + user.local.email + ') ' +
                ' convidou você para usar o aplicativo ' + (AMMailing.config.appName ? AMMailing.config.appName : AMMailing.config.fromName) + '. \n\n' +
                    'Para aceitar o convite, entre no link: ' + AMInvite.config.baseUrlAndRoute + '/' + invite._id.toString();
                console.log('texto', text);
                const html = text.replace(/(?:\r\n|\r|\n)/g, '<br/>');
                console.log(html);
                let email = await AMMailing.sendEmail(emailToInvite, subject, text, html);
                console.log(email);
            }
            return invite;
        } catch (e) {
            console.error(e);
        }
    }

    static async addInvites (user, personsToInvite) {
        let invites = [];
        for (let person of personsToInvite) {
            invites.push(await AMInvite.addInvite(user, person.email, person.phone));
        }
        return invites;
    }

    /**
     * Check if user was invited, if true, do some things.
     */
    static async checkInvite (user) {
        let invite = await AMInvite.findInviteByEmailPhone(user.local.email);
        // console.log("invite",invite);
        if (invite) {
            AMInvite.accept(invite, user);
        }
    }

    static async findInviteByEmailPhone (email, phone) {
        let connection = mongoose.connection;
        const Invite = connection.model('invite');

        // Check if email already invited
        if (email) {
            let emailInvite = await Invite.findOne({email: email});
            if (emailInvite)
                return emailInvite;
        }

        // Check if phone already invited
        if (phone) {
            let phoneInvite = await Invite.findOne({phone: phone});
            if (phoneInvite)
                return phoneInvite;
        }
        return null;
    }

    static async accept (invite, newUser) {
        let connection = mongoose.connection;
        const Invite = connection.model('invite');

        let find = {'_id': invite};
        let obj = await Invite.findOne(find);

        // Another user already accepted the invite. Create a new one.
        if (obj.accepted) {
            let newInvite = {
                user: obj.user
            };
            obj = await Invite.create(newInvite);
            find = {'_id': obj._id};
        }

        obj.accepted = true;
        obj.acceptedAt = new Date();
        obj.userAccepted = newUser;
        invite = await Invite.findItOneAndUpdate(find, obj);

        if (AMInvite.acceptCallback)
            AMInvite.acceptCallback(invite);

        return invite;
    }

    static async addClick (inviteId) {
        const connection = mongoose.connection;
        const Invite = connection.model('invite');
        const now = new Date();

        // console.log('addClick - inviteId', inviteId);
        // const invite = await Invite.find(inviteId);
        // console.log('invite', invite);

        await Invite.update(
            {_id: inviteId},
            {
                $push: {clicks: now},
                $inc: {clickCount: 1}
            }
        );
    }

    // Statistics
    static getStartDate (days) {
        days = days || 7;
        const startDate = new Date(new Date().setDate(new Date().getDate() - days));
        return startDate;
    }

    static async amountClickedSinceDays (days) {
        const connection = mongoose.connection;
        const Invite = connection.model('invite');
        const startDate = this.getStartDate(days);

        const amount = await Invite.aggregate([
            {
                $match: {
                    clicks: {$gte: startDate}
                }
            },
            {
                $project: {
                    clicks: {
                        $filter: {
                            input: '$clicks',
                            as: 'click',
                            cond: {$gte: ['$$click', startDate]}
                        }
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: {$sum: {'$size': '$clicks'}}
                }
            }
        ]);

        return amount[0].count;
    }

    static async amountSentSinceDays (days) {
        const connection = mongoose.connection;
        const Invite = connection.model('invite');
        const startDate = this.getStartDate(days);

        const amount = await Invite.find({
            created_at: {$gte: startDate}
        }).count();

        return amount;
    }

    static async amountAcceptedSinceDays (days) {
        const connection = mongoose.connection;
        const Invite = connection.model('invite');
        const startDate = this.getStartDate(days);

        const amount = await Invite.find({
            accepted: true,
            acceptedAt: {$gte: startDate}
        }).count();

        return amount;
    }

    // static createQueue() {
    //     AMInvite.model.find({inviteSent: {$exists: false}, error: {$exists: false}})
    //         .then(result => {
    //             console.log(result);
    //             AMInvite.sendEmailInQueue(result);
    //         })
    // }
    //
    // static updateModel(where, attribute) {
    //     return AMInvite.model.update(where, attribute);
    // }
    //
    // static async sendEmailInQueue(queue) {
    //     for (let i = 0; i < queue.length; i++) {
    //         let person = queue[i];
    //         console.log('sending email to: ', person.email);
    //         const MESSAGE = 'Baixe agora o app Emagreça Já';
    //         const HTML = `<h1>Emagreça já</h1> <p>venha conferir nosso app</p> <a href="http://localhost:3000/api/invitation/${person._id}">Emagreça já</a>`;
    //         try {
    //             let success = await AMMailing.sendEmail(person.email, 'convite', MESSAGE, HTML);
    //             /* console.log('----------------------------------------');
    //             console.log(success);
    //             console.log('----------------------------------------'); */
    //
    //             await AMInvite.updateModel({
    //                 email: person.email,
    //                 inviteSent: {$exists: false}
    //             }, {inviteSent: new Date()});
    //             console.log('email sent to: ', person.email);
    //             console.log('emails left to be sent: ', queue.length - (i + 1));
    //         } catch (err) {
    //             console.log('AMInvite.sendEmailInQueue', err.message)
    //
    //             if (err.message === 'No recipients defined') {
    //                 await AMInvite.updateModel({email: person.email}, {error: err.message});
    //             } else {
    //                 throw new Error(err);
    //             }
    //         }
    //     }
    //     console.log('All emails were sent');
    // }
}

AMInvite.config = null;
AMInvite.model = null;

module.exports = AMInvite;
